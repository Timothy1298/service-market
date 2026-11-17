import "dotenv/config";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import helmet from "helmet";
import crypto from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { brandingSettingsSchema, businessProfileSettingsSchema, businessSettingsSchema, userPreferencesSchema } from "./features/businessSettings";
import { queueNotificationEvent } from "./features/notifications/events";
import { processNotificationQueue, cleanupExpiredNotifications, runNotificationReminders } from "./features/notifications/service";
import { createNotificationRouter } from "./features/notifications/routes";
import { phoneSchema, registrationSchema } from "./features/auth/validation";
import { sendPasswordResetEmail } from "./features/auth/passwordResetEmail";
import {
  InvoiceStatus,
  PrismaClient,
  Prisma,
  type User,
  type UserRole,
} from "./generated/prisma/client";

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const port = Number(process.env.PORT ?? 4000);
const origin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const sessionSecret =
  process.env.SESSION_SECRET ?? "development-only-change-me";
if (
  process.env.NODE_ENV === "production" &&
  (sessionSecret === "development-only-change-me" || sessionSecret.length < 32)
)
  throw new Error(
    "SESSION_SECRET must be configured with at least 32 characters in production",
  );
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

app.use(helmet());
app.use(cors({ origin, credentials: true }));
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
    req.headers.cookie
  ) {
    const requestOrigin = req.headers.origin;
    if (requestOrigin && requestOrigin !== origin)
      return res.status(403).json({ error: "Request origin is not allowed" });
  }
  next();
});
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(
      `[api] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - startedAt}ms`,
    );
  });
  next();
});

type AuthedRequest = Request & { user?: User };
const cookieOptions = `Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
const hashPassword = (
  password: string,
  salt = crypto.randomBytes(16).toString("hex"),
) =>
  new Promise<string>((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (error, derived) =>
      error ? reject(error) : resolve(`${salt}:${derived.toString("hex")}`),
    ),
  );
const verifyPassword = (password: string, stored: string) =>
  new Promise<boolean>((resolve, reject) => {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return resolve(false);
    crypto.scrypt(password, salt, 64, (error, derived) =>
      error
        ? reject(error)
        : resolve(crypto.timingSafeEqual(Buffer.from(hash, "hex"), derived)),
    );
  });
const tokenHash = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");
const parseCookies = (header = "") =>
  Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("=" as string))
      .filter(([key, value]) => key && value),
  );
const publicUser = (user: User) => ({
  id: user.id,
  fullName: user.fullName,
  phone: user.phone,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
});
const loginSchema = z.object({
  identifier: z.string().trim().min(3),
  password: z.string().min(1),
});
const auth = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const sessionId = parseCookies(req.headers.cookie).fq_session;
    const session = sessionId
      ? await prisma.session.findUnique({ where: { id: sessionId } })
      : undefined;
    if (!session || session.expiresAt < new Date()) {
      if (sessionId)
        await prisma.session.deleteMany({ where: { id: sessionId } });
      return res.status(401).json({ error: "Authentication required" });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
    });
    if (!user?.isActive)
      return res.status(401).json({ error: "Authentication required" });
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};
const role =
  (...roles: UserRole[]) =>
  (req: AuthedRequest, res: Response, next: NextFunction) =>
    req.user && roles.includes(req.user.role)
      ? next()
      : res
          .status(403)
          .json({ error: "You do not have permission to perform this action" });
const issueSession = async (res: Response, userId: string) => {
  const id = crypto.randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      id,
      userId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    },
  });
  res.setHeader("Set-Cookie", `fq_session=${id}; ${cookieOptions}`);
};
const rateLimit =
  (name: string, max: number, windowMs: number) =>
  (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${req.ip ?? "unknown"}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now)
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    else {
      bucket.count += 1;
      if (bucket.count > max)
        return res
          .status(429)
          .json({ error: "Too many attempts. Please try again shortly." });
    }
    next();
  };

app.use("/api/notifications", auth, createNotificationRouter(prisma));

app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", service: "fundiquote-api" }),
);
app.post(
  "/api/auth/register",
  rateLimit("register", 8, 15 * 60 * 1000),
  async (req, res, next) => {
    try {
      const data = registrationSchema.parse(req.body);
      const phone = data.phone.replace(/^\+?254/, "0");
      const email = data.email || null;
      const existing = await prisma.user.findFirst({
        where: { OR: [{ phone }, ...(email ? [{ email }] : [])] },
      });
      if (existing) {
        const phoneAlreadyUsed = existing.phone === phone;
        const accountLabel = data.accountType === "CUSTOMER" ? "customer" : "provider";
        const existingLabel = existing.role === "CUSTOMER" ? "customer" : existing.role === "PROVIDER" ? "provider" : "administrator";
        return res
          .status(409)
          .json({
            error: phoneAlreadyUsed && existing.role !== data.accountType
              ? `This phone number already has a ${existingLabel} account. Sign in to that account or use a different number for a ${accountLabel} account.`
              : phoneAlreadyUsed
                ? "That phone number is already registered. Sign in to your existing account."
                : "That email address is already registered. Sign in to your existing account.",
          });
      }
      const passwordHash = await hashPassword(data.password);
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            fullName: data.fullName,
            phone,
            email,
            passwordHash,
            role: data.accountType,
          },
        });
        if (data.accountType === "PROVIDER") {
          const business = await tx.business.create({
            data: { name: data.businessName!, phone, email },
          });
          await tx.businessMember.create({
            data: {
              businessId: business.id,
              userId: created.id,
              role: "OWNER",
            },
          });
          await tx.providerProfile.create({
            data: {
              userId: created.id,
              businessId: business.id,
              tradeCategory: data.tradeCategory!,
            },
          });
        } else
          await tx.customerProfile.create({ data: { userId: created.id } });
        return created;
      });
      await issueSession(res, user.id);
      res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/auth/login",
  rateLimit("login", 10, 15 * 60 * 1000),
  async (req, res, next) => {
    try {
      const data = loginSchema.parse(req.body);
      const identifier = data.identifier.replace(/[\s-]/g, "");
      const user = await prisma.user.findFirst({
        where: {
          OR: [{ phone: identifier }, { email: identifier.toLowerCase() }],
        },
      });
      if (
        !user ||
        !user.isActive ||
        !(await verifyPassword(data.password, user.passwordHash))
      )
        return res.status(401).json({ error: "Invalid sign-in details" });
      await issueSession(res, user.id);
      res.json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  },
);
app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const id = parseCookies(req.headers.cookie).fq_session;
    if (id) await prisma.session.deleteMany({ where: { id } });
    res.setHeader("Set-Cookie", `fq_session=; Max-Age=0; ${cookieOptions}`);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
app.get("/api/auth/me", async (req, res, next) => {
  try {
    const sessionId = parseCookies(req.headers.cookie).fq_session;
    const session = sessionId
      ? await prisma.session.findUnique({ where: { id: sessionId } })
      : undefined;
    if (!session || session.expiresAt < new Date())
      return res.json({ user: null });
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
    });
    res.json({ user: user?.isActive ? publicUser(user) : null });
  } catch (error) {
    next(error);
  }
});
app.post(
  "/api/auth/forgot-password",
  rateLimit("recovery", 5, 15 * 60 * 1000),
  async (req, res, next) => {
    try {
      const input = z
        .object({ identifier: z.string().trim().min(3) })
        .parse(req.body);
      const identifier = input.identifier.replace(/[\s-]/g, "");
      const normalizedPhone = identifier.replace(/^\+?254/, "0");
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: identifier.toLowerCase() },
            { phone: normalizedPhone },
          ],
        },
      });
      if (user?.isActive && user.email) {
        const token = crypto.randomBytes(32).toString("hex");
        const reset = await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: tokenHash(token),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        });
        try {
          const configuredResetUrl = new URL(process.env.RESET_LINK_BASE_URL ?? process.env.APP_BASE_URL ?? origin);
          const resetUrl = `${configuredResetUrl.origin}/#/reset-password?token=${encodeURIComponent(token)}`;
          await sendPasswordResetEmail(user.email, resetUrl);
          await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, id: { not: reset.id } } });
        } catch (deliveryError) {
          await prisma.passwordResetToken.deleteMany({ where: { id: reset.id } });
          console.warn("[auth] password-reset email was not delivered", {
            userId: user.id,
            reason: deliveryError instanceof Error ? deliveryError.message : "Unknown email delivery error",
          });
        }
      }
      res.json({
        message:
          "If an active account matches those details and has an email address, recovery instructions will be sent when email delivery is available.",
      });
    } catch (error) {
      next(error);
    }
  },
);
app.post("/api/auth/reset-password", async (req, res, next) => {
  try {
    const input = z
      .object({
        token: z.string().min(20),
        password: z
          .string()
          .min(8)
          .regex(/[A-Za-z]/)
          .regex(/\d/),
      })
      .parse(req.body);
    const reset = await prisma.passwordResetToken.findFirst({
      where: {
        tokenHash: tokenHash(input.token),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!reset)
      return res
        .status(400)
        .json({ error: "That reset link is invalid or expired" });
    const passwordHash = await hashPassword(input.password);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: reset.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
      prisma.session.deleteMany({ where: { userId: reset.userId } }),
    ]);
    res.json({ message: "Password updated. You can now sign in." });
  } catch (error) {
    next(error);
  }
});
app.get("/api/profile", auth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        customerProfile: true,
        providerProfile: { include: { business: true } },
      },
    });
    res.json({
      user: publicUser(user!),
      profile: user?.customerProfile ?? user?.providerProfile,
    });
  } catch (error) {
    next(error);
  }
});
app.patch("/api/profile", auth, async (req: AuthedRequest, res, next) => {
  try {
    const data = z
      .object({
        fullName: z.string().trim().min(2).max(100),
        phone: phoneSchema,
        email: z.string().trim().email().optional().or(z.literal("")),
      })
      .parse(req.body);
    const phone = data.phone.replace(/^\+?254/, "0");
    const duplicate = await prisma.user.findFirst({
      where: {
        OR: [{ phone }, ...(data.email ? [{ email: data.email }] : [])],
        NOT: { id: req.user!.id },
      },
    });
    if (duplicate)
      return res
        .status(409)
        .json({ error: "That phone number or email is already registered" });
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { fullName: data.fullName, phone, email: data.email || null },
    });
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});
app.get(
  "/api/business-profile",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const profile = await prisma.providerProfile.findUnique({
        where: { userId: req.user!.id },
        include: { business: true },
      });
      if (!profile)
        return res.status(404).json({ error: "Business profile not found" });
      res.json({ profile });
    } catch (error) {
      next(error);
    }
  },
);
app.patch(
  "/api/business-profile",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().trim().min(2).max(120),
          phone: phoneSchema,
          email: z.string().trim().email().optional().or(z.literal("")),
          address: z.string().trim().max(200).optional(),
          tradeCategory: z.string().trim().min(2).max(80),
          slogan: z.string().trim().max(160).optional(),
          paymentInstructions: z.string().trim().max(500).optional(),
          mpesaNumber: z.string().trim().max(30).optional(),
        })
        .parse(req.body);
      const provider = await prisma.providerProfile.findUnique({
        where: { userId: req.user!.id },
      });
      if (!provider)
        return res.status(404).json({ error: "Business profile not found" });
      const profile = await prisma.$transaction(async (tx) => {
        await tx.providerProfile.update({
          where: { userId: req.user!.id },
          data: { tradeCategory: input.tradeCategory },
        });
        return tx.business.update({
          where: { id: provider.businessId },
          data: {
            name: input.name,
            phone: input.phone.replace(/^\+?254/, "0"),
            email: input.email || null,
            address: input.address,
            slogan: input.slogan,
            paymentInstructions: input.paymentInstructions,
            mpesaNumber: input.mpesaNumber,
          },
        });
      });
      res.json({ profile });
    } catch (error) {
      next(error);
    }
  },
);
const settingsMembership = async (userId: string) => prisma.businessMember.findFirst({ where: { userId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, include: { business: true } });
app.get("/api/settings/business", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await settingsMembership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business administrator access required" });
    const [provider, members] = await prisma.$transaction([
      prisma.providerProfile.findUnique({ where: { userId: membership.userId }, select: { tradeCategory: true } }),
      prisma.businessMember.findMany({ where: { businessId: membership.businessId }, orderBy: { createdAt: "asc" }, select: { id: true, role: true, status: true, createdAt: true, user: { select: { id: true, fullName: true, email: true, phone: true } } } }),
    ]);
    const settings = businessSettingsSchema.parse(membership.business.settings ?? {});
    const { MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CALLBACK_URL } = process.env;
    const emailConfigured=Boolean(process.env.BREVO_API_KEY&&process.env.BREVO_FROM_EMAIL),smsConfigured=Boolean(process.env.AT_API_KEY&&process.env.AT_USERNAME);
    res.json({ business: { ...membership.business, kraPin: membership.business.kraPin, tradeCategory: provider?.tradeCategory ?? "" }, settings, team: members, capabilities: { canEdit: membership.role === "OWNER", mpesaConfigured: Boolean(MPESA_CONSUMER_KEY && MPESA_CONSUMER_SECRET && MPESA_SHORTCODE && MPESA_PASSKEY && MPESA_CALLBACK_URL), notificationChannels: ["in-app",...(emailConfigured?["email"]:[]),...(smsConfigured?["sms"]:[])], communicationChannels:{inApp:{configured:true,enabled:true},email:{configured:emailConfigured,enabled:emailConfigured},sms:{configured:smsConfigured,enabled:smsConfigured},whatsapp:{configured:false,enabled:false}}, logoUpload: false } });
  } catch (error) { next(error); }
});
app.patch("/api/settings/business", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await settingsMembership(req.user!.id);
    if (!membership || membership.role !== "OWNER") return res.status(403).json({ error: "Only the business owner can change business settings" });
    const input = businessProfileSettingsSchema.parse(req.body);
    const phone = phoneSchema.parse(input.phone).replace(/^\+?254/, "0");
    const alternativePhone = input.alternativePhone ? phoneSchema.parse(input.alternativePhone).replace(/^\+?254/, "0") : null;
    const [business] = await prisma.$transaction([
      prisma.business.update({ where: { id: membership.businessId }, data: { name: input.name, tradingName: input.tradingName || null, description: input.description || null, businessType: input.businessType || null, phone, alternativePhone, email: input.email || null, website: input.website || null, address: input.address || null, town: input.town || null, county: input.county || null, country: input.country, postalAddress: input.postalAddress || null, postalCode: input.postalCode || null, registrationNumber: input.registrationNumber || null, kraPin: input.kraPin || null, slogan: input.slogan || null, paymentInstructions: input.paymentInstructions || null, mpesaNumber: input.mpesaNumber || null, currency: input.currency, settings: input.settings } }),
      prisma.providerProfile.update({ where: { userId: req.user!.id }, data: { tradeCategory: input.tradeCategory } }),
    ]);
    res.json({ business: { ...business, settings: businessSettingsSchema.parse(business.settings) } });
  } catch (error) { next(error); }
});
app.get("/api/settings/preferences", auth, async (req: AuthedRequest, res, next) => {
  try { const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { preferences: true } }); res.json({ preferences: userPreferencesSchema.parse(user.preferences ?? {}) }); }
  catch (error) { next(error); }
});
app.patch("/api/settings/preferences", auth, async (req: AuthedRequest, res, next) => {
  try { const preferences = userPreferencesSchema.parse(req.body); await prisma.user.update({ where: { id: req.user!.id }, data: { preferences } }); res.json({ preferences }); }
  catch (error) { next(error); }
});
app.get("/api/settings/security/sessions", auth, async (req: AuthedRequest, res, next) => {
  try { const currentId = parseCookies(req.headers.cookie).fq_session; const sessions = await prisma.session.findMany({ where: { userId: req.user!.id, expiresAt: { gt: new Date() } }, select: { id: true, createdAt: true, expiresAt: true }, orderBy: { createdAt: "desc" } }); res.json({ sessions: sessions.map(({ id, ...session }) => ({ ...session, current: id === currentId })) }); }
  catch (error) { next(error); }
});
app.delete("/api/settings/security/sessions", auth, async (req: AuthedRequest, res, next) => {
  try { const currentId = parseCookies(req.headers.cookie).fq_session; const result = await prisma.session.deleteMany({ where: { userId: req.user!.id, ...(currentId ? { id: { not: currentId } } : {}) } }); res.json({ revoked: result.count }); }
  catch (error) { next(error); }
});
app.patch("/api/settings/team/:id", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const owner=await settingsMembership(req.user!.id);
    if(!owner||owner.role!=="OWNER")return res.status(403).json({error:"Only a business owner can manage team members"});
    const input=z.object({role:z.enum(["OWNER","ADMIN","MEMBER"]).optional(),status:z.enum(["ACTIVE","SUSPENDED"]).optional()}).strict().refine(value=>value.role!==undefined||value.status!==undefined).parse(req.body);
    const updated=await prisma.$transaction(async tx=>{
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${owner.businessId}), hashtext('membership-owners'))`);
      const target=await tx.businessMember.findFirst({where:{id:String(req.params.id),businessId:owner.businessId}});
      if(!target)return {error:"Team member not found",status:404 as const};
      if(target.userId===req.user!.id&&((input.role&&input.role!=="OWNER")||(input.status&&input.status!=="ACTIVE")))return {error:"You cannot remove your own owner access",status:400 as const};
      if(target.role==="OWNER"&&((input.role&&input.role!=="OWNER")||(input.status&&input.status!=="ACTIVE"))){const owners=await tx.businessMember.count({where:{businessId:owner.businessId,role:"OWNER",status:"ACTIVE"}});if(owners<=1)return {error:"The business must keep at least one active owner",status:409 as const};}
      const member=await tx.businessMember.update({where:{id:target.id},data:input,select:{id:true,userId:true,role:true,status:true,createdAt:true,user:{select:{id:true,fullName:true,email:true,phone:true}}}});
      if(input.role&&input.role!==target.role)await queueNotificationEvent(tx,{businessId:owner.businessId,actorUserId:req.user!.id,idempotencyKey:`team-role:${target.id}:${member.role}:${Date.now()}`,eventType:"TEAM_ROLE_CHANGED",payload:{role:member.role,recipientUserIds:[target.userId],actionUrl:"/app/settings/team"}});
      return {member,status:200 as const};
    });
    if("error" in updated)return res.status(updated.status).json({error:updated.error});
    res.status(updated.status).json({member:updated.member});
  }catch(error){next(error);}
});
app.post("/api/settings/security/password", auth, async (req: AuthedRequest, res, next) => {
  try {
    const input = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128).regex(/[A-Za-z]/).regex(/\d/) }).strict().parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) return res.status(400).json({ error: "Current password is incorrect" });
    const passwordHash = await hashPassword(input.newPassword); const currentId = parseCookies(req.headers.cookie).fq_session;
    await prisma.$transaction(async tx=>{await tx.user.update({where:{id:user.id},data:{passwordHash}});await tx.session.deleteMany({where:{userId:user.id,...(currentId?{id:{not:currentId}}:{})}});await queueNotificationEvent(tx,{actorUserId:user.id,idempotencyKey:`password-changed:${user.id}:${Date.now()}`,eventType:"PASSWORD_CHANGED",payload:{recipientUserIds:[user.id]}})});
    res.json({ changed: true });
  } catch (error) { next(error); }
});
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    const fields = error.flatten().fieldErrors as Record<string, string[]>;
    console.warn(
      `[api] validation failed: ${Object.entries(fields)
        .map(([field, messages]) => `${field}=${messages.join(", ")}`)
        .join("; ")}`,
    );
    return res
      .status(400)
      .json({ error: "Please correct the highlighted fields", fields });
  }
  console.error(
    "[api] request failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.get("/api/marketplace/categories", async (_req, res, next) => {
  try {
    const categories = await prisma.serviceCategory.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, slug: true, name: true, description: true },
    });
    res.json({ categories });
  } catch (error) {
    next(error);
  }
});
app.get("/api/marketplace/providers", async (req, res, next) => {
  try {
    const query = z
      .object({
        search: z.string().trim().max(80).optional(),
        category: z.string().trim().max(80).optional(),
        location: z.string().trim().max(80).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(30).default(12),
      })
      .parse(req.query);
    const where = {
      providerProfiles: { some: {} },
      AND: [
        ...(query.search ? [{ OR: [
          { name: { contains: query.search, mode: "insensitive" as const } },
          { slogan: { contains: query.search, mode: "insensitive" as const } },
          { serviceListings: { some: { status: "PUBLISHED" as const, OR: [{ title: { contains: query.search, mode: "insensitive" as const } }, { description: { contains: query.search, mode: "insensitive" as const } }] } } },
        ] }] : []),
        ...(query.location ? [{ OR: [{ town: { contains: query.location, mode: "insensitive" as const } }, { county: { contains: query.location, mode: "insensitive" as const } }, { address: { contains: query.location, mode: "insensitive" as const } }] }] : []),
      ],
      ...(query.category ? { OR: [
        { providerProfiles: { some: { tradeCategory: { equals: query.category, mode: "insensitive" as const } } } },
        { serviceListings: { some: { status: "PUBLISHED" as const, category: { name: { equals: query.category, mode: "insensitive" as const } } } } },
      ] } : {}),
    };
    const [businesses, total] = await prisma.$transaction([
      prisma.business.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          slogan: true,
          address: true,
          currency: true,
          providerProfiles: {
            select: { tradeCategory: true, serviceDescription: true },
          },
          serviceListings: {
            where: { status: "PUBLISHED" },
            select: {
              id: true,
              title: true,
              description: true,
              startingPrice: true,
              category: { select: { slug: true, name: true } },
            },
          },
          _count: { select: { customerReviews: true } },
        },
      }),
      prisma.business.count({ where }),
    ]);
    res.json({
      providers: businesses,
      page: query.page,
      pageSize: query.pageSize,
      total,
    });
  } catch (error) {
    next(error);
  }
});
app.get("/api/marketplace/providers/:id", async (req, res, next) => {
  try {
    const business = await prisma.business.findFirst({
      where: { id: String(req.params.id), providerProfiles: { some: {} } },
      select: {
        id: true,
        name: true,
        slogan: true,
        address: true,
        phone: true,
        providerProfiles: {
          select: {
            tradeCategory: true,
            serviceDescription: true,
            location: true,
          },
        },
        serviceListings: {
          where: { status: "PUBLISHED" },
          select: {
            id: true,
            title: true,
            description: true,
            startingPrice: true,
            category: { select: { slug: true, name: true } },
          },
        },
        customerReviews: { select: { rating: true } },
      },
    });
    if (!business) return res.status(404).json({ error: "Provider not found" });
    res.json({ provider: business });
  } catch (error) {
    next(error);
  }
});
app.get("/api/customer-portal/dashboard", auth, role("CUSTOMER"), async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const [requests, quotations, jobs, invoices, profile, recentRequests] = await Promise.all([
      prisma.serviceRequest.count({ where: { customerId: userId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      prisma.quotation.count({ where: { customer: { userId }, status: "ISSUED" } }),
      prisma.job.count({ where: { customer: { userId }, status: { in: ["SCHEDULED", "IN_PROGRESS", "ON_HOLD"] } } }),
      prisma.invoice.count({ where: { customer: { userId }, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } } }),
      prisma.customerProfile.findUnique({ where: { userId } }),
      prisma.serviceRequest.findMany({ where: { customerId: userId }, orderBy: { updatedAt: "desc" }, take: 5, include: { category: { select: { name: true } }, quotations: { select: { id: true, status: true, grandTotal: true } } } }),
    ]);
    res.json({ stats: { requests, quotations, jobs, invoices }, profile, recentRequests });
  } catch (error) { next(error); }
});
app.get("/api/customer-portal/profile", auth, role("CUSTOMER"), async (req: AuthedRequest, res, next) => {
  try { const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, fullName: true, email: true, phone: true, customerProfile: true } }); res.json({ profile: user }); }
  catch (error) { next(error); }
});
app.patch("/api/customer-portal/profile", auth, role("CUSTOMER"), async (req: AuthedRequest, res, next) => {
  try {
    const input = z.object({ fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().optional().or(z.literal("")), phone: z.string().trim().min(8).max(20), location: z.string().trim().max(240).optional().or(z.literal("")) }).strict().parse(req.body);
    const profile = await prisma.$transaction(async tx => {
      const user = await tx.user.update({ where: { id: req.user!.id }, data: { fullName: input.fullName, email: input.email || null, phone: input.phone }, select: { id: true, fullName: true, email: true, phone: true } });
      const customerProfile = await tx.customerProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, location: input.location || null }, update: { location: input.location || null } });
      return { ...user, customerProfile };
    });
    res.json({ profile });
  } catch (error) { next(error); }
});
app.get("/api/customer-portal/quotations", auth, role("CUSTOMER"), async (req: AuthedRequest, res, next) => {
  try { const quotations = await prisma.quotation.findMany({ where: { customer: { userId: req.user!.id }, status: { notIn: ["DRAFT", "SUPERSEDED"] } }, include: { business: { select: { id: true, name: true, logoReference: true } }, items: { orderBy: { sortOrder: "asc" } }, request: { select: { id: true, title: true } } }, orderBy: { createdAt: "desc" }, take: 100 }); res.json({ quotations }); }
  catch (error) { next(error); }
});
app.post("/api/customer-portal/quotations/:id/respond", auth, role("CUSTOMER"), async (req: AuthedRequest, res, next) => {
  try {
    const { decision } = z.object({ decision: z.enum(["ACCEPTED", "REJECTED"]) }).strict().parse(req.body);
    const quotation = await prisma.quotation.findFirst({ where: { id: String(req.params.id), customer: { userId: req.user!.id }, status: "ISSUED" }, include: { customer: true } });
    if (!quotation) return res.status(404).json({ error: "Issued quotation not found" });
    if (quotation.expiryDate && quotation.expiryDate < new Date()) return res.status(409).json({ error: "This quotation has expired" });
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.quotation.updateMany({ where: { id: quotation.id, status: "ISSUED" }, data: { status: decision } });
      if (!result.count) throw Object.assign(new Error("This quotation has already been answered"), { statusCode: 409 });
      await queueNotificationEvent(tx, { businessId: quotation.businessId, actorUserId: req.user!.id, idempotencyKey: `customer-quotation-response:${quotation.id}:${decision}`, eventType: decision === "ACCEPTED" ? "QUOTATION_ACCEPTED" : "QUOTATION_REJECTED", payload: { reference: quotation.quotationNumber, name: quotation.customer.name, actionUrl: `/app/quotations/${quotation.id}` } });
      return tx.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
    });
    res.json({ quotation: updated });
  } catch (error) { next(error); }
});
app.get("/api/customer-portal/jobs", auth, role("CUSTOMER"), async (req: AuthedRequest, res, next) => {
  try { const jobs = await prisma.job.findMany({ where: { customer: { userId: req.user!.id } }, include: { business: { select: { id: true, name: true } }, quotation: { select: { quotationNumber: true, grandTotal: true } }, activities: { orderBy: { createdAt: "desc" }, take: 10, select: { type: true, message: true, createdAt: true } } }, orderBy: { createdAt: "desc" } }); res.json({ jobs }); }
  catch (error) { next(error); }
});
app.get("/api/customer-portal/invoices", auth, role("CUSTOMER"), async (req: AuthedRequest, res, next) => {
  try { const invoices = await prisma.invoice.findMany({ where: { customer: { userId: req.user!.id }, status: { notIn: ["DRAFT", "CANCELLED"] } }, include: { business: { select: { id: true, name: true } }, items: true, payments: { orderBy: { paymentDate: "desc" } }, mpesaAttempts: { orderBy: { requestedAt: "desc" }, take: 5 } }, orderBy: { issueDate: "desc" } }); res.json({ invoices }); }
  catch (error) { next(error); }
});
app.get("/api/customer-portal/favorites", auth, role("CUSTOMER"), async (req: AuthedRequest, res, next) => {
  try { const favorites = await prisma.favoriteProvider.findMany({ where: { customerId: req.user!.id }, include: { business: { select: { id: true, name: true, slogan: true, address: true, providerProfiles: { select: { tradeCategory: true } }, serviceListings: { where: { status: "PUBLISHED" }, select: { id: true, title: true } } } } }, orderBy: { createdAt: "desc" } }); res.json({ favorites }); }
  catch (error) { next(error); }
});
app.get("/api/customer-portal/conversations", auth, role("CUSTOMER"), async (req: AuthedRequest, res, next) => {
  try { const conversations = await prisma.customerConversation.findMany({ where: { customerId: req.user!.id }, include: { business: { select: { id: true, name: true } }, request: { select: { id: true, title: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } }); res.json({ conversations }); }
  catch (error) { next(error); }
});
app.post("/api/customer-portal/conversations", auth, role("CUSTOMER"), async (req: AuthedRequest, res, next) => {
  try {
    const input = z.object({ businessId: z.string().uuid(), serviceRequestId: z.string().uuid().optional() }).strict().parse(req.body);
    if (input.serviceRequestId) {
      const request = await prisma.serviceRequest.findFirst({ where: { id: input.serviceRequestId, customerId: req.user!.id }, select: { id: true, categoryId: true, providerBusinessId: true } });
      if (!request) return res.status(404).json({ error: "Service request not found" });
      if (request.providerBusinessId && request.providerBusinessId !== input.businessId) return res.status(403).json({ error: "This request is assigned to another provider" });
      const listed = await prisma.serviceListing.findFirst({ where: { businessId: input.businessId, categoryId: request.categoryId, status: "PUBLISHED" } });
      if (!listed && request.providerBusinessId !== input.businessId) return res.status(403).json({ error: "This provider is not eligible for this request" });
    }
    const whereConversation = { customerId: req.user!.id, businessId: input.businessId, serviceRequestId: input.serviceRequestId ?? null };
    const existing = await prisma.customerConversation.findFirst({ where: whereConversation });
    const conversation = existing ?? await prisma.customerConversation.create({ data: { customerId: req.user!.id, businessId: input.businessId, serviceRequestId: input.serviceRequestId }, include: { business: { select: { id: true, name: true } } } });
    res.status(201).json({ conversation });
  } catch (error) { next(error); }
});
app.get("/api/customer-conversations/:id/messages", auth, async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id); const conversation = await prisma.customerConversation.findUnique({ where: { id }, select: { id: true, customerId: true, businessId: true } });
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    const allowed = req.user!.role === "CUSTOMER" ? conversation.customerId === req.user!.id : req.user!.role === "PROVIDER" && !!(await prisma.businessMember.findFirst({ where: { userId: req.user!.id, businessId: conversation.businessId, status: "ACTIVE" }, select: { id: true } }));
    if (!allowed) return res.status(404).json({ error: "Conversation not found" });
    const messages = await prisma.customerMessage.findMany({ where: { conversationId: id }, include: { sender: { select: { id: true, fullName: true, role: true } } }, orderBy: { createdAt: "asc" } });
    await prisma.customerMessage.updateMany({ where: { conversationId: id, senderId: { not: req.user!.id }, readAt: null }, data: { readAt: new Date() } }); res.json({ messages });
  } catch (error) { next(error); }
});
app.post("/api/customer-conversations/:id/messages", auth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ body: z.string().trim().min(1).max(4000) }).strict().parse(req.body); const id = String(req.params.id);
    const conversation = await prisma.customerConversation.findUnique({ where: { id }, select: { id: true, customerId: true, businessId: true } }); if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    const allowed = req.user!.role === "CUSTOMER" ? conversation.customerId === req.user!.id : req.user!.role === "PROVIDER" && !!(await prisma.businessMember.findFirst({ where: { userId: req.user!.id, businessId: conversation.businessId, status: "ACTIVE" }, select: { id: true } })); if (!allowed) return res.status(404).json({ error: "Conversation not found" });
    const message = await prisma.$transaction(async tx => {
      const created = await tx.customerMessage.create({ data: { conversationId: id, senderId: req.user!.id, body: body.body }, include: { sender: { select: { fullName: true, role: true } } } });
      await tx.customerConversation.update({ where: { id }, data: { updatedAt: new Date() } });
      const recipients = req.user!.role === "CUSTOMER" ? await tx.businessMember.findMany({ where: { businessId: conversation.businessId, status: "ACTIVE" }, select: { userId: true } }).then(rows => rows.map(row => row.userId)) : [conversation.customerId];
      await queueNotificationEvent(tx, { businessId: conversation.businessId, actorUserId: req.user!.id, idempotencyKey: `customer-message:${created.id}`, eventType: "MESSAGE_RECEIVED", payload: { name: created.sender.fullName, recipientUserIds: recipients, customerFacing: req.user!.role === "PROVIDER", actionUrl: req.user!.role === "CUSTOMER" ? "/app/messages" : "/customer/messages" } });
      return created;
    }); res.status(201).json({ message });
  } catch (error) { next(error); }
});
app.get("/api/provider/conversations", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try { const membership = await providerMembership(req.user!.id); if (!membership) return res.status(403).json({ error: "Business membership required" }); const conversations = await prisma.customerConversation.findMany({ where: { businessId: membership.businessId }, include: { customer: { select: { id: true, fullName: true } }, request: { select: { id: true, title: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } }); res.json({ conversations }); }
  catch (error) { next(error); }
});
app.put("/api/customer-portal/favorites/:businessId", auth, role("CUSTOMER"), async (req: AuthedRequest, res, next) => {
  try { const businessId = String(req.params.businessId); const business = await prisma.business.findFirst({ where: { id: businessId, providerProfiles: { some: {} } }, select: { id: true } }); if (!business) return res.status(404).json({ error: "Provider not found" }); const favorite = await prisma.favoriteProvider.upsert({ where: { customerId_businessId: { customerId: req.user!.id, businessId } }, create: { customerId: req.user!.id, businessId }, update: {} }); res.status(201).json({ favorite }); }
  catch (error) { next(error); }
});
app.delete("/api/customer-portal/favorites/:businessId", auth, role("CUSTOMER"), async (req: AuthedRequest, res, next) => {
  try { await prisma.favoriteProvider.deleteMany({ where: { customerId: req.user!.id, businessId: String(req.params.businessId) } }); res.json({ removed: true }); }
  catch (error) { next(error); }
});
app.get("/api/customer-portal/reviews", auth, role("CUSTOMER"), async (req: AuthedRequest, res, next) => {
  try { const reviews = await prisma.customerReview.findMany({ where: { customerId: req.user!.id }, include: { business: { select: { id: true, name: true } }, job: { select: { id: true, jobNumber: true, title: true } } }, orderBy: { createdAt: "desc" } }); res.json({ reviews }); }
  catch (error) { next(error); }
});
app.post("/api/customer-portal/jobs/:jobId/review", auth, role("CUSTOMER"), async (req: AuthedRequest, res, next) => {
  try { const input = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional() }).strict().parse(req.body); const job = await prisma.job.findFirst({ where: { id: String(req.params.jobId), customer: { userId: req.user!.id }, status: "COMPLETED" }, select: { id: true, businessId: true } }); if (!job) return res.status(404).json({ error: "Completed job not found" }); const review = await prisma.customerReview.create({ data: { customerId: req.user!.id, businessId: job.businessId, jobId: job.id, ...input } }); res.status(201).json({ review }); }
  catch (error) { next(error); }
});
app.get(
  "/api/provider/listings",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await prisma.businessMember.findFirst({
        where: {
          userId: req.user!.id,
          status: "ACTIVE",
          role: { in: ["OWNER", "ADMIN", "MEMBER"] },
        },
      });
      if (!membership)
        return res.status(403).json({ error: "Business membership required" });
      const listings = await prisma.serviceListing.findMany({
        where: { businessId: membership.businessId },
        include: { category: { select: { id: true, slug: true, name: true } } },
        orderBy: { createdAt: "desc" },
      });
      res.json({ listings });
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/provider/listings",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const input = z
        .object({
          categoryId: z.string().uuid(),
          title: z.string().trim().min(2).max(120),
          description: z.string().trim().min(10).max(2000),
          startingPrice: z.coerce.number().nonnegative().optional(),
          status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
        })
        .parse(req.body);
      const membership = await prisma.businessMember.findFirst({
        where: { userId: req.user!.id, status: "ACTIVE" },
      });
      if (!membership)
        return res.status(403).json({ error: "Business membership required" });
      const listing = await prisma.serviceListing.create({
        data: {
          businessId: membership.businessId,
          categoryId: input.categoryId,
          title: input.title,
          description: input.description,
          startingPrice: input.startingPrice,
          status: input.status,
        },
      });
      res.status(201).json({ listing });
    } catch (error) {
      next(error);
    }
  },
);
app.patch(
  "/api/provider/listings/:id",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const input = z
        .object({
          title: z.string().trim().min(2).max(120).optional(),
          description: z.string().trim().min(10).max(2000).optional(),
          startingPrice: z.coerce.number().nonnegative().nullable().optional(),
          status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
        })
        .strict()
        .parse(req.body);
      const membership = await prisma.businessMember.findFirst({
        where: { userId: req.user!.id, status: "ACTIVE" },
      });
      if (!membership)
        return res.status(403).json({ error: "Business membership required" });
      const listing = await prisma.serviceListing.updateMany({
        where: { id: String(req.params.id), businessId: membership.businessId },
        data: input,
      });
      if (!listing.count)
        return res.status(404).json({ error: "Listing not found" });
      res.json({ updated: true });
    } catch (error) {
      next(error);
    }
  },
);
const requestInput = z
  .object({
    categoryId: z.string().uuid(),
    providerBusinessId: z.string().uuid().optional(),
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(3000),
    location: z.string().trim().min(2).max(160),
    budgetMin: z.coerce.number().nonnegative().optional(),
    budgetMax: z.coerce.number().nonnegative().optional(),
    preferredDate: z.coerce.date().optional(),
  })
  .refine(
    (value) =>
      value.budgetMin === undefined ||
      value.budgetMax === undefined ||
      value.budgetMax >= value.budgetMin,
    {
      path: ["budgetMax"],
      message: "Maximum budget must be greater than minimum budget",
    },
  );
app.post(
  "/api/requests",
  auth,
  role("CUSTOMER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const input = requestInput.parse(req.body);
      if (input.providerBusinessId) {
        const eligible = await prisma.business.findFirst({ where: { id: input.providerBusinessId, serviceListings: { some: { categoryId: input.categoryId, status: "PUBLISHED" } } }, select: { id: true } });
        if (!eligible) return res.status(400).json({ error: "This provider does not currently list that service" });
      }
      const request = await prisma.$transaction(async tx=>{
        const created=await tx.serviceRequest.create({data:{...input,customerId:req.user!.id}});
        const listings=await tx.serviceListing.findMany({where:{categoryId:created.categoryId,status:"PUBLISHED",...(created.providerBusinessId?{businessId:created.providerBusinessId}:{})},select:{businessId:true}});
        const members=listings.length?await tx.businessMember.findMany({where:{businessId:{in:[...new Set(listings.map(item=>item.businessId))]},status:"ACTIVE"},select:{userId:true}}):[];
        await queueNotificationEvent(tx,{actorUserId:req.user!.id,idempotencyKey:`service-request-created:${created.id}`,eventType:"REQUEST_CREATED",payload:{reference:created.id,name:created.title,recipientUserIds:[...new Set(members.map(member=>member.userId))]}});
        return created;
      });
      res.status(201).json({ request });
    } catch (error) {
      next(error);
    }
  },
);
app.get(
  "/api/requests",
  auth,
  role("CUSTOMER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const query = z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(30).default(20),
          status: z
            .enum(["OPEN", "IN_PROGRESS", "FULFILLED", "CANCELLED"])
            .optional(),
        })
        .parse(req.query);
      const where = {
        customerId: req.user!.id,
        ...(query.status ? { status: query.status } : {}),
      };
      const [requests, total] = await prisma.$transaction([
        prisma.serviceRequest.findMany({
          where,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          orderBy: { createdAt: "desc" },
          include: {
            category: { select: { slug: true, name: true } },
            quotations: {
              select: {
                id: true,
                quotationNumber: true,
                status: true,
                grandTotal: true,
              },
            },
          },
        }),
        prisma.serviceRequest.count({ where }),
      ]);
      res.json({ requests, page: query.page, pageSize: query.pageSize, total });
    } catch (error) {
      next(error);
    }
  },
);
app.get("/api/requests/:id", auth, async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const providerContext = req.user!.role === "PROVIDER" ? await providerMembership(req.user!.id) : null;
    const providerCategories = providerContext ? await prisma.serviceListing.findMany({ where: { businessId: providerContext.businessId, status: "PUBLISHED" }, select: { categoryId: true } }) : [];
    const request = await prisma.serviceRequest.findFirst({
      where:
        req.user!.role === "CUSTOMER"
          ? { id, customerId: req.user!.id }
          : req.user!.role === "PROVIDER" && providerContext
            ? { id, status: { in: ["OPEN", "IN_PROGRESS"] }, OR: [{ providerBusinessId: providerContext.businessId }, { providerBusinessId: null, categoryId: { in: providerCategories.map(item => item.categoryId) } }] }
            : req.user!.role === "ADMIN" ? { id, status: { in: ["OPEN", "IN_PROGRESS"] } } : { id: "" },
      include: {
        category: true,
        quotations: {
          select: {
            id: true,
            quotationNumber: true,
            status: true,
            grandTotal: true,
            currency: true,
          },
        },
      },
    });
    if (!request)
      return res.status(404).json({ error: "Service request not found" });
    res.json({ request });
  } catch (error) {
    next(error);
  }
});
app.patch(
  "/api/requests/:id",
  auth,
  role("CUSTOMER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const input = requestInput
        .partial()
        .extend({ status: z.enum(["OPEN", "CANCELLED"]).optional() })
        .strict()
        .parse(req.body);
      const current = await prisma.serviceRequest.findFirst({
        where: { id: String(req.params.id), customerId: req.user!.id },
      });
      if (!current)
        return res.status(404).json({ error: "Service request not found" });
      if (current.status !== "OPEN")
        return res
          .status(409)
          .json({ error: "Only open requests can be changed" });
      const request = await prisma.$transaction(async tx=>{
        const updated=await tx.serviceRequest.update({where:{id:current.id},data:input});
        if(Object.keys(input).length){
          const listings=await tx.serviceListing.findMany({where:{categoryId:current.categoryId,status:"PUBLISHED",...(current.providerBusinessId?{businessId:current.providerBusinessId}:{})},select:{businessId:true}});
          const members=listings.length?await tx.businessMember.findMany({where:{businessId:{in:[...new Set(listings.map(item=>item.businessId))]},status:"ACTIVE"},select:{userId:true}}):[];
          const cancelled=input.status==="CANCELLED";
          await queueNotificationEvent(tx,{actorUserId:req.user!.id,idempotencyKey:cancelled?`service-request-cancelled:${current.id}`:`service-request-updated:${current.id}:${current.updatedAt.getTime()}`,eventType:cancelled?"REQUEST_CANCELLED":"REQUEST_UPDATED",payload:{reference:current.id,name:current.title,recipientUserIds:[...new Set(members.map(member=>member.userId))]}});
        }
        return updated;
      });
      res.json({ request });
    } catch (error) {
      next(error);
    }
  },
);
app.get(
  "/api/provider/requests",
  auth,
  role("PROVIDER"),
  async (_req: AuthedRequest, res, next) => {
    try {
      const membership = await providerMembership(_req.user!.id);
      if (!membership) return res.status(403).json({ error: "Business membership required" });
      const categories = await prisma.serviceListing.findMany({ where: { businessId: membership.businessId, status: "PUBLISHED" }, select: { categoryId: true } });
      const requests = await prisma.serviceRequest.findMany({
        where: { status: "OPEN", categoryId: { in: categories.map(item => item.categoryId) }, OR: [{ providerBusinessId: null }, { providerBusinessId: membership.businessId }] },
        orderBy: { createdAt: "asc" },
        take: 50,
        select: {
          id: true,
          title: true,
          description: true,
          location: true,
          budgetMin: true,
          budgetMax: true,
          preferredDate: true,
          createdAt: true,
          category: { select: { slug: true, name: true } },
        },
      });
      res.json({ requests });
    } catch (error) {
      next(error);
    }
  },
);
const customerInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: z
      .string()
      .trim()
      .regex(/^(?:\+?254|0)7\d{8}$/)
      .transform((value) =>
        value.replace(/[\s-]/g, "").replace(/^\+?254/, "0"),
      ),
    email: z.string().trim().email().optional().or(z.literal("")),
    billingAddress: z.string().trim().max(240).optional(),
    projectLocation: z.string().trim().max(240).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
const providerMembership = async (userId: string) =>
  prisma.businessMember.findFirst({ where: { userId, status: "ACTIVE" } });
const nextDocumentNumber = async (tx: Prisma.TransactionClient, businessId: string, kind: "invoice" | "quotation" | "job", settings: ReturnType<typeof businessSettingsSchema.parse>) => {
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${businessId}), hashtext(${kind}))`);
  const count = kind === "invoice" ? await tx.invoice.count({ where: { businessId } }) : kind === "quotation" ? await tx.quotation.count({ where: { businessId } }) : await tx.job.count({ where: { businessId } });
  const prefix = kind === "invoice" ? settings.documents.invoicePrefix : kind === "quotation" ? settings.documents.quotationPrefix : settings.documents.jobPrefix;
  const serial = String(count + 1).padStart(settings.documents.padding, "0");
  return settings.documents.includeYear ? `${prefix}-${new Date().getFullYear()}-${serial}` : `${prefix}-${serial}`;
};
app.get(
  "/api/customers",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await providerMembership(req.user!.id);
      if (!membership)
        return res.status(403).json({ error: "Business membership required" });
      const query = z
        .object({
          search: z.string().trim().max(80).optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(50).default(20),
        })
        .parse(req.query);
      const where = {
        businessId: membership.businessId,
        ...(query.search
          ? {
              OR: [
                {
                  name: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                { phone: { contains: query.search } },
              ],
            }
          : {}),
      };
      const [customers, total] = await prisma.$transaction([
        prisma.customerRecord.findMany({
          where,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          orderBy: { name: "asc" },
        }),
        prisma.customerRecord.count({ where }),
      ]);
      res.json({
        customers,
        page: query.page,
        pageSize: query.pageSize,
        total,
      });
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/customers",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await providerMembership(req.user!.id);
      if (!membership)
        return res.status(403).json({ error: "Business membership required" });
      const input = customerInput.parse(req.body);
      const customer = await prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${membership.businessId}), hashtext('plan-customers'))`);
        await enforcePlanLimit(tx, membership.businessId, "customers");
        return tx.customerRecord.create({ data: { ...input, email: input.email || null, businessId: membership.businessId } });
      });
      res.status(201).json({ customer });
    } catch (error) {
      next(error);
    }
  },
);
// ── RESTORED: customers stats (must stay above /api/customers/:id) ──
app.get("/api/customers/stats", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await providerMembership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [total, newThisMonth, invoices] = await prisma.$transaction([
      prisma.customerRecord.count({ where: { businessId: membership.businessId } }),
      prisma.customerRecord.count({
        where: { businessId: membership.businessId, createdAt: { gte: monthStart } },
      }),
      prisma.invoice.findMany({
        where: {
          businessId: membership.businessId,
          status: { notIn: ["DRAFT", "CANCELLED", "PAID"] },
        },
        select: { customerId: true, grandTotal: true, amountPaid: true },
      }),
    ]);
    const balanceByCustomer = new Map<string, number>();
    for (const invoice of invoices) {
      const balance = Math.max(0, Number(invoice.grandTotal) - Number(invoice.amountPaid));
      balanceByCustomer.set(
        invoice.customerId,
        (balanceByCustomer.get(invoice.customerId) ?? 0) + balance,
      );
    }
    const balances = [...balanceByCustomer.values()].filter((balance) => balance > 0);
    res.json({
      total,
      newThisMonth,
      withBalance: balances.length,
      outstandingTotal: balances.reduce((sum, balance) => sum + balance, 0),
    });
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/customers/:id",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await providerMembership(req.user!.id);
      if (!membership)
        return res.status(403).json({ error: "Business membership required" });
      const customer = await prisma.customerRecord.findFirst({
        where: { id: String(req.params.id), businessId: membership.businessId },
      });
      if (!customer)
        return res.status(404).json({ error: "Customer not found" });
      res.json({ customer });
    } catch (error) {
      next(error);
    }
  },
);
app.patch(
  "/api/customers/:id",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await providerMembership(req.user!.id);
      if (!membership)
        return res.status(403).json({ error: "Business membership required" });
      const input = customerInput.partial().parse(req.body);
      const result = await prisma.customerRecord.updateMany({
        where: { id: String(req.params.id), businessId: membership.businessId },
        data: {
          ...input,
          ...(input.email !== undefined ? { email: input.email || null } : {}),
        },
      });
      if (!result.count)
        return res.status(404).json({ error: "Customer not found" });
      const customer = await prisma.customerRecord.findFirst({
        where: { id: String(req.params.id), businessId: membership.businessId },
      });
      res.json({ customer });
    } catch (error) {
      next(error);
    }
  },
);
// ── RESTORED: subscription paywall (402 for unpaid quotation/invoice features) ──
const paidFeaturePath = (path: string) =>
  path === "/api/quotations" ||
  (path.startsWith("/api/quotations/") && !path.startsWith("/api/quotations/share/")) ||
  path === "/api/invoices" ||
  path.startsWith("/api/invoices/");
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== "production" || !paidFeaturePath(req.path)) return next();
  auth(req as AuthedRequest, res, async () => {
    const authed = req as AuthedRequest;
    const membership = await providerMembership(authed.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    if (!(await activeSubscription(membership.businessId)))
      return res
        .status(402)
        .json({ error: "An active subscription is required for this paid feature" });
    next();
  });
});
const monthlyPrice = () => Number(process.env.SUBSCRIPTION_MONTHLY_PRICE ?? 299);
const subscriptionForBusiness = async (businessId: string) => {
  const subscription = await prisma.subscription.findFirst({
    where: { businessId, status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { createdAt: "desc" },
  }) ?? await prisma.subscription.findFirst({
    where: { businessId, status: { in: ["ACTIVE", "PENDING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (
    subscription?.status === "ACTIVE" &&
    subscription.expiresAt &&
    subscription.expiresAt <= new Date()
  )
    return prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: "EXPIRED" },
    });
  return subscription;
};
const activeSubscription = async (businessId: string) => {
  const subscription = await subscriptionForBusiness(businessId);
  return subscription?.status === "ACTIVE" &&
    !!subscription.expiresAt &&
    subscription.expiresAt > new Date()
    ? subscription
    : null;
};
type PlanLimitKey = "customers" | "quotationsPerMonth" | "teamMembers";
const enforcePlanLimit = async (tx: Prisma.TransactionClient, businessId: string, key: PlanLimitKey) => {
  const now = new Date();
  const active = await tx.subscription.findFirst({ where: { businessId, status: "ACTIVE", expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
  const plan = await tx.subscriptionPlan.findUnique({ where: { code: active?.planCode ?? "FREE" }, select: { limits: true } });
  const configured = plan?.limits && typeof plan.limits === "object" && !Array.isArray(plan.limits) ? (plan.limits as Prisma.JsonObject)[key] : undefined;
  if (typeof configured !== "number" || !Number.isInteger(configured) || configured < 0) return;
  let used = 0;
  if (key === "customers") used = await tx.customerRecord.count({ where: { businessId } });
  if (key === "teamMembers") used = await tx.businessMember.count({ where: { businessId, status: "ACTIVE" } });
  if (key === "quotationsPerMonth") {
    const { monthStart } = getNairobiDayMonthBounds(now);
    used = await tx.quotation.count({ where: { businessId, createdAt: { gte: monthStart } } });
  }
  if (used >= configured) throw Object.assign(new Error(`Your plan limit of ${configured} ${key === "quotationsPerMonth" ? "quotations this month" : key} has been reached. Review your plan to continue.`), { statusCode: 409 });
};
const expireDueSubscriptions = async () => {
  const due = await prisma.subscription.findMany({ where: { status: "ACTIVE", expiresAt: { lte: new Date() } }, select: { id: true, businessId: true, planCode: true, expiresAt: true }, take: 200 });
  for (const subscription of due) await prisma.$transaction(async tx => {
    const changed = await tx.subscription.updateMany({ where: { id: subscription.id, status: "ACTIVE", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
    if (!changed.count) return;
    await queueNotificationEvent(tx, { businessId: subscription.businessId, idempotencyKey: `subscription-expired:${subscription.id}`, eventType: "SUBSCRIPTION_EXPIRED", payload: { plan: subscription.planCode, expiresAt: subscription.expiresAt?.toISOString(), actionUrl: "/app/billing" } });
  });
};

const moneyCents = (value: number) => Math.round(value * 100);
const centsMoney = (value: number) => (value / 100).toFixed(2);
const addCalendarMonths = (from: Date, months: number) => {
  const result = new Date(from);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
};
const configuredReceiptNumber = (paymentId: string, settings: ReturnType<typeof businessSettingsSchema.parse>) => `${settings.documents.receiptPrefix}-${paymentId.slice(0, 8).toUpperCase()}`;
const paymentMethodEnum = z.enum(["CASH", "BANK_TRANSFER", "MPESA", "OTHER"]);
const paymentSortEnum = z.enum(["newest", "oldest", "amount"]);
const toNairobiDateParts = (value: Date) => {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const parts = Object.fromEntries(
    formatted
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};
export const getNairobiDayMonthBounds = (value: Date) => {
  const parts = toNairobiDateParts(value);
  const pad = (digit: number) => String(digit).padStart(2, "0");
  const monthStart = new Date(`${parts.year}-${pad(parts.month)}-01T00:00:00+03:00`);
  const monthEnd = new Date(`${parts.year}-${pad(parts.month)}-${new Date(parts.year, parts.month, 0).getDate()}T23:59:59.999+03:00`);
  const dayStart = new Date(`${parts.year}-${pad(parts.month)}-${pad(parts.day)}T00:00:00+03:00`);
  const dayEnd = new Date(`${parts.year}-${pad(parts.month)}-${pad(parts.day)}T23:59:59.999+03:00`);
  return { monthStart, monthEnd, dayStart, dayEnd };
};
const quotationItemInput = z
  .object({
    description: z.string().trim().min(1).max(240),
    quantity: z.coerce.number().positive().max(100000),
    unit: z.string().trim().min(1).max(30),
    unitPrice: z.coerce.number().nonnegative().max(100000000),
  })
  .strict();
const quotationInput = z
  .object({
    customerId: z.string().uuid(),
    serviceRequestId: z.string().uuid().optional(),
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(3000).optional(),
    location: z.string().trim().max(240).optional(),
    expiryDate: z.coerce.date().optional(),
    discount: z.coerce.number().nonnegative().default(0),
    tax: z.coerce.number().nonnegative().optional(),
    terms: z.string().trim().max(4000).optional(),
    paymentTerms: z.string().trim().max(1000).optional(),
    items: z.array(quotationItemInput).min(1).max(100),
  })
  .strict();
const calculateQuotation = (
  items: Array<z.infer<typeof quotationItemInput>>,
  discount: number,
  tax: number,
) => {
  const lineItems = items.map((item) => ({
    ...item,
    lineTotal: centsMoney(moneyCents(item.quantity * item.unitPrice)),
  }));
  const subtotal = lineItems.reduce(
    (sum, item) => sum + moneyCents(Number(item.lineTotal)),
    0,
  );
  const grandTotal = subtotal - moneyCents(discount) + moneyCents(tax);
  if (grandTotal < 0) throw new Error("Quotation total cannot be negative");
  return {
    lineItems,
    subtotal: centsMoney(subtotal),
    discount: centsMoney(moneyCents(discount)),
    tax: centsMoney(moneyCents(tax)),
    grandTotal: centsMoney(grandTotal),
  };
};
app.get(
  "/api/quotations",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await providerMembership(req.user!.id);
      if (!membership)
        return res.status(403).json({ error: "Business membership required" });
      const quotations = await prisma.quotation.findMany({
        where: { businessId: membership.businessId },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          customer: {
            select: { id: true, name: true, phone: true, email: true },
          },
          items: true,
        },
      });
      res.json({ quotations });
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/quotations",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      if (
        process.env.NODE_ENV === "production" &&
        process.env.QUOTATION_ENTITLEMENT !== "enabled"
      )
        return res
          .status(402)
          .json({ error: "An active subscription is required for quotations" });
      const membership = await providerMembership(req.user!.id);
      if (!membership)
        return res.status(403).json({ error: "Business membership required" });
      const input = quotationInput.parse(req.body);
      const customer = await prisma.customerRecord.findFirst({
        where: { id: input.customerId, businessId: membership.businessId },
      });
      if (!customer)
        return res.status(404).json({ error: "Customer not found" });
      if (input.serviceRequestId) {
        const request = await prisma.serviceRequest.findFirst({ where: { id: input.serviceRequestId, status: { in: ["OPEN", "IN_PROGRESS"] } }, include: { customer: { select: { id: true, phone: true, email: true } } } });
        if (!request) return res.status(404).json({ error: "Open service request not found" });
        if (request.providerBusinessId && request.providerBusinessId !== membership.businessId) return res.status(403).json({ error: "This request was assigned to another provider" });
        const eligibleListing = await prisma.serviceListing.findFirst({ where: { businessId: membership.businessId, categoryId: request.categoryId, status: "PUBLISHED" }, select: { id: true } });
        if (!eligibleListing && request.providerBusinessId !== membership.businessId) return res.status(403).json({ error: "Your business is not listed for this request category" });
        const contactMatches = (customer.phone && customer.phone === request.customer.phone) || (customer.email && request.customer.email && customer.email.toLowerCase() === request.customer.email.toLowerCase());
        if (!contactMatches && customer.userId !== request.customer.id) return res.status(400).json({ error: "Select the customer who submitted this service request" });
        await prisma.customerRecord.updateMany({ where: { id: customer.id, userId: null }, data: { userId: request.customer.id } });
      }
      const business = await prisma.business.findUniqueOrThrow({ where: { id: membership.businessId }, select: { currency: true, settings: true } });
      const businessSettings = businessSettingsSchema.parse(business.settings ?? {});
      const configuredTax=businessSettings.tax.enabled?centsMoney(Math.round(moneyCents(input.items.reduce((sum,item)=>sum+item.quantity*item.unitPrice,0)-input.discount)*businessSettings.tax.rate/100)):0;
      const totals = calculateQuotation(input.items, input.discount, Number(input.tax??configuredTax));
      const expiryDate = input.expiryDate ?? new Date(Date.now() + businessSettings.documents.quotationValidityDays * 86400000);
      const quotation = await prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${membership.businessId}), hashtext('plan-quotations'))`);
        await enforcePlanLimit(tx, membership.businessId, "quotationsPerMonth");
        const quotationNumber = await nextDocumentNumber(tx, membership.businessId, "quotation", businessSettings);
        return tx.quotation.create({
        data: {
          businessId: membership.businessId,
          customerId: customer.id,
          serviceRequestId: input.serviceRequestId,
          quotationNumber,
          title: input.title,
          description: input.description,
          location: input.location,
          currency: business.currency,
          expiryDate,
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          grandTotal: totals.grandTotal,
          terms: input.terms || businessSettings.documents.quotationNotes || undefined,
          paymentTerms: input.paymentTerms || businessSettings.documents.quotationPaymentTerms || undefined,
          items: {
            create: totals.lineItems.map((item, index) => ({
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
              sortOrder: index,
            })),
          },
        },
        include: { items: true, customer: true },
      });
      });
      res.status(201).json({ quotation });
    } catch (error) {
      next(error);
    }
  },
);
app.get(
  "/api/quotations/:id",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await providerMembership(req.user!.id);
      if (!membership)
        return res.status(403).json({ error: "Business membership required" });
      const quotation = await prisma.quotation.findFirst({
        where: { id: String(req.params.id), businessId: membership.businessId },
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          customer: true,
          request: true,
          invoices: { select: { id: true, invoiceNumber: true, status: true } },
        },
      });
      if (!quotation)
        return res.status(404).json({ error: "Quotation not found" });
      res.json({ quotation });
    } catch (error) {
      next(error);
    }
  },
);
app.patch(
  "/api/quotations/:id",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await providerMembership(req.user!.id);
      if (!membership)
        return res.status(403).json({ error: "Business membership required" });
      const current = await prisma.quotation.findFirst({
        where: { id: String(req.params.id), businessId: membership.businessId },
      });
      if (!current)
        return res.status(404).json({ error: "Quotation not found" });
      if (current.status !== "DRAFT")
        return res
          .status(409)
          .json({ error: "Only draft quotations can be edited" });
      const input = quotationInput.parse(req.body);
      const customer = await prisma.customerRecord.findFirst({
        where: { id: input.customerId, businessId: membership.businessId },
      });
      if (!customer)
        return res.status(404).json({ error: "Customer not found" });
      const totals = calculateQuotation(input.items, input.discount, input.tax??Number(current.tax));
      const quotation = await prisma.$transaction(async (tx) => {
        await tx.quotationItem.deleteMany({
          where: { quotationId: current.id },
        });
        return tx.quotation.update({
          where: { id: current.id },
          data: {
            customerId: input.customerId,
            serviceRequestId: input.serviceRequestId,
            title: input.title,
            description: input.description,
            location: input.location,
            expiryDate: input.expiryDate,
            subtotal: totals.subtotal,
            discount: totals.discount,
            tax: totals.tax,
            grandTotal: totals.grandTotal,
            terms: input.terms,
            paymentTerms: input.paymentTerms,
            items: {
              create: totals.lineItems.map((item, index) => ({
                description: item.description,
                quantity: item.quantity,
                unit: item.unit,
                unitPrice: item.unitPrice,
                lineTotal: item.lineTotal,
                sortOrder: index,
              })),
            },
          },
          include: { items: true, customer: true },
        });
      });
      res.json({ quotation });
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/quotations/:id/issue",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await providerMembership(req.user!.id);
      if (!membership)
        return res.status(403).json({ error: "Business membership required" });
      const current = await prisma.quotation.findFirst({
        where: {
          id: String(req.params.id),
          businessId: membership.businessId,
          status: "DRAFT",
        },
        include: { business: true, customer: true, items: true },
      });
      if (!current)
        return res.status(404).json({ error: "Draft quotation not found" });
      const matchingCustomer = current.customer.phone ? await prisma.user.findFirst({ where: { phone: current.customer.phone, role: "CUSTOMER" }, select: { id: true } }) : current.customer.email ? await prisma.user.findFirst({ where: { email: { equals: current.customer.email, mode: "insensitive" }, role: "CUSTOMER" }, select: { id: true } }) : null;
      const shareToken=crypto.randomBytes(32).toString("hex");
      const issued = await prisma.$transaction(async tx => {
        if (matchingCustomer) await tx.customerRecord.updateMany({ where: { id: current.customerId, userId: null }, data: { userId: matchingCustomer.id } });
        const quotation = await tx.quotation.update({
        where: { id: current.id },
        data: {
          status: "ISSUED",
          issueDate: new Date(),
          issuedSnapshot: {
            business: {
            name: businessSettingsSchema.parse(current.business.settings ?? {}).branding.displayName || current.business.tradingName || current.business.name,
              phone: current.business.phone,
              email: current.business.email,
              address: current.business.address,
              slogan: current.business.slogan,
            branding: businessSettingsSchema.parse(current.business.settings ?? {}).branding,
            },
            taxLabel: businessSettingsSchema.parse(current.business.settings ?? {}).tax.label,
            customer: {
              name: current.customer.name,
              phone: current.customer.phone,
              email: current.customer.email,
              billingAddress: current.customer.billingAddress,
            },
            totals: {
              subtotal: current.subtotal.toString(),
              discount: current.discount.toString(),
              tax: current.tax.toString(),
              grandTotal: current.grandTotal.toString(),
            },
          },
        },
      });
        await tx.quotationShare.create({data:{quotationId:current.id,tokenHash:tokenHash(shareToken),expiresAt:new Date(Date.now()+30*86400000)}});
        await queueNotificationEvent(tx,{businessId:membership.businessId,actorUserId:req.user!.id,idempotencyKey:`quotation-issued:${current.id}`,eventType:"QUOTATION_SENT",payload:{reference:current.quotationNumber,name:current.customer.name,customerFacing:true,actionUrl:"/customer/quotations",businessActionUrl:`/app/quotations/${current.id}`,...(matchingCustomer?{recipientUserIds:[matchingCustomer.id]}:{})}});
        return quotation;
      });
      res.json({ quotation: issued });
    } catch (error) {
      next(error);
    }
  },
);
const invoiceItemInput = z.object({
  description: z.string().trim().min(1).max(240),
  quantity: z.coerce.number().positive().max(100000),
  unit: z.string().trim().min(1).max(30).default("unit"),
  unitPrice: z.coerce.number().nonnegative().max(100000000),
}).strict();
const invoiceInput = z.object({
  customerId: z.string().uuid(),
  quotationId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  issueDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  discount: z.coerce.number().nonnegative().default(0),
  tax: z.coerce.number().nonnegative().optional(),
  paymentTerms: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(3000).optional(),
  items: z.array(invoiceItemInput).min(1).max(100),
}).strict().refine(data => !data.issueDate || !data.dueDate || data.dueDate >= data.issueDate, { path: ["dueDate"], message: "Due date cannot be before the issue date" });
const calculateInvoice = (items: Array<z.infer<typeof invoiceItemInput>>, discount: number, tax: number) => {
  const lineItems = items.map(item => ({ ...item, lineTotal: centsMoney(moneyCents(item.quantity * item.unitPrice)) }));
  const subtotalCents = lineItems.reduce((sum, item) => sum + moneyCents(Number(item.lineTotal)), 0);
  const discountCents = moneyCents(discount);
  const taxCents = moneyCents(tax);
  if (discountCents > subtotalCents) throw Object.assign(new Error("Discount cannot exceed the subtotal"), { statusCode: 400 });
  return { lineItems, subtotal: centsMoney(subtotalCents), discount: centsMoney(discountCents), tax: centsMoney(taxCents), grandTotal: centsMoney(subtotalCents - discountCents + taxCents) };
};
const invoiceInclude = { customer: true, business: true, items: { orderBy: { sortOrder: "asc" as const } }, payments: { orderBy: { paymentDate: "desc" as const } }, quotation: { select: { id: true, quotationNumber: true, title: true } }, job: { select: { id: true, jobNumber: true, title: true } } };
app.get("/api/invoices", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await providerMembership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const query = z.object({ search: z.string().trim().max(100).optional(), status: z.enum(["ALL", "DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"]).default("ALL"), source: z.enum(["ALL", "DIRECT", "QUOTATION"]).default("ALL"), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50), sort: z.enum(["issueDate", "dueDate", "grandTotal", "createdAt"]).default("createdAt"), direction: z.enum(["asc", "desc"]).default("desc") }).parse(req.query);
    const isOverdueFilter = query.status === "OVERDUE";
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const where = { businessId: membership.businessId, ...(query.status !== "ALL" && !isOverdueFilter ? { status: query.status as InvoiceStatus } : isOverdueFilter ? { status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] }, dueDate: { lt: today } } : {}), ...(query.source === "DIRECT" ? { quotationId: null } : query.source === "QUOTATION" ? { quotationId: { not: null } } : {}), ...(query.search ? { OR: [{ invoiceNumber: { contains: query.search, mode: "insensitive" as const } }, { customer: { name: { contains: query.search, mode: "insensitive" as const } } }] } : {}) };
    let invoices = await prisma.invoice.findMany({ where, include: invoiceInclude, orderBy: { [query.sort]: query.direction } });
    if (isOverdueFilter) invoices = invoices.filter(item => moneyCents(Number(item.grandTotal)) > moneyCents(Number(item.amountPaid)));
    const total = invoices.length;
    invoices = invoices.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    res.json({ invoices, page: query.page, pageSize: query.pageSize, total });
  } catch (error) { next(error); }
});
app.get("/api/invoices/stats", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await providerMembership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const invoices = await prisma.invoice.findMany({ where: { businessId: membership.businessId } });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const valid = invoices.filter(item => item.status !== "CANCELLED");
    const open = valid.filter(item => item.status !== "DRAFT" && Number(item.grandTotal) > Number(item.amountPaid));
    const overdue = open.filter(item => item.dueDate && item.dueDate < today);
    res.json({ total: invoices.length, awaitingPayment: open.reduce((sum, item) => sum + Math.max(0, moneyCents(Number(item.grandTotal) - Number(item.amountPaid))), 0) / 100, paid: valid.filter(item => Number(item.grandTotal) <= Number(item.amountPaid) && Number(item.grandTotal) > 0).length, overdue: overdue.length, overdueAmount: overdue.reduce((sum, item) => sum + Math.max(0, moneyCents(Number(item.grandTotal) - Number(item.amountPaid))), 0) / 100 });
  } catch (error) { next(error); }
});
app.post("/api/invoices", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await providerMembership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const input = invoiceInput.parse(req.body);
    const [customer, business] = await Promise.all([prisma.customerRecord.findFirst({ where: { id: input.customerId, businessId: membership.businessId } }), prisma.business.findUnique({ where: { id: membership.businessId } })]);
    if (!customer || !business) return res.status(404).json({ error: "Customer not found" });
    const quote = input.quotationId ? await prisma.quotation.findFirst({ where: { id: input.quotationId, businessId: membership.businessId }, include: { items: true, jobs: true } }) : null;
    if (input.quotationId) {
      if (!quote) return res.status(404).json({ error: "Quotation not found" });
      if (quote.status !== "ACCEPTED") return res.status(409).json({ error: "Only accepted quotations can be invoiced" });
      if (quote.customerId !== customer.id) return res.status(400).json({ error: "Invoice customer must match the quotation" });
      if (await prisma.invoice.findFirst({ where: { quotationId: quote.id } })) return res.status(409).json({ error: "This quotation already has an invoice" });
    }
    let jobId: string | undefined;
    if (input.jobId) {
      const job = await prisma.job.findFirst({ where: { id: input.jobId, businessId: membership.businessId, customerId: customer.id } });
      if (!job) return res.status(404).json({ error: "Job not found" });
      jobId = job.id;
    } else if (quote?.jobs[0]) jobId = quote.jobs[0].id;
    const items = quote ? quote.items.map(item => ({ description: item.description, quantity: Number(item.quantity), unit: item.unit, unitPrice: Number(item.unitPrice) })) : input.items;
    const businessSettings = businessSettingsSchema.parse(business.settings ?? {});
    const invoiceDiscount=quote?Number(quote.discount):input.discount;
    const configuredTax=businessSettings.tax.enabled?centsMoney(Math.round(moneyCents(items.reduce((sum,item)=>sum+item.quantity*item.unitPrice,0)-invoiceDiscount)*businessSettings.tax.rate/100)):0;
    const invoiceTax=quote?Number(quote.tax):Number(input.tax??configuredTax);
    const totals = calculateInvoice(items, invoiceDiscount, invoiceTax);
    const invoice = await prisma.$transaction(async tx => {
      const invoiceNumber = await nextDocumentNumber(tx, membership.businessId, "invoice", businessSettings);
      return tx.invoice.create({ data: { businessId: membership.businessId, customerId: customer.id, jobId, quotationId: quote?.id, invoiceNumber, issueDate: input.issueDate, dueDate: input.dueDate, currency: business.currency, subtotal: totals.subtotal, discount: totals.discount, tax: totals.tax, grandTotal: totals.grandTotal, paymentTerms: input.paymentTerms || quote?.paymentTerms || businessSettings.documents.invoicePaymentTerms, notes: input.notes || quote?.terms || quote?.description || businessSettings.documents.invoiceNotes || undefined, items: { create: totals.lineItems.map((item, index) => ({ ...item, sortOrder: index })) } }, include: invoiceInclude });
    });
    res.status(201).json({ invoice });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return res.status(409).json({ error: "This quotation already has an invoice" });
    next(error);
  }
});
app.get("/api/invoices/:id", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await providerMembership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const invoice = await prisma.invoice.findFirst({ where: { id: String(req.params.id), businessId: membership.businessId }, include: invoiceInclude });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json({ invoice });
  } catch (error) { next(error); }
});
app.patch("/api/invoices/:id", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await providerMembership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const current = await prisma.invoice.findFirst({ where: { id: String(req.params.id), businessId: membership.businessId } });
    if (!current) return res.status(404).json({ error: "Invoice not found" });
    if (current.status !== "DRAFT") return res.status(409).json({ error: "Only draft invoices can be edited" });
    const input = invoiceInput.parse(req.body);
    const customer = await prisma.customerRecord.findFirst({ where: { id: input.customerId, businessId: membership.businessId } });
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    const totals = calculateInvoice(input.items, input.discount, input.tax??Number(current.tax));
    const invoice = await prisma.$transaction(async tx => {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: current.id } });
      return tx.invoice.update({ where: { id: current.id }, data: { customerId: customer.id, issueDate: input.issueDate, dueDate: input.dueDate, subtotal: totals.subtotal, discount: totals.discount, tax: totals.tax, grandTotal: totals.grandTotal, paymentTerms: input.paymentTerms, notes: input.notes, items: { create: totals.lineItems.map((item, index) => ({ ...item, sortOrder: index })) } }, include: invoiceInclude });
    });
    res.json({ invoice });
  } catch (error) { next(error); }
});
app.post("/api/invoices/:id/issue", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await providerMembership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const current = await prisma.invoice.findFirst({ where: { id: String(req.params.id), businessId: membership.businessId } });
    if (!current) return res.status(404).json({ error: "Invoice not found" });
    if (current.status !== "DRAFT") return res.status(409).json({ error: "Only draft invoices can be issued" });
    const [business, customer] = await Promise.all([prisma.business.findUniqueOrThrow({ where: { id: membership.businessId } }), prisma.customerRecord.findUniqueOrThrow({ where: { id: current.customerId } })]);
    const customerUser=customer.phone?await prisma.user.findFirst({where:{role:"CUSTOMER",phone:customer.phone},select:{id:true}}):customer.email?await prisma.user.findFirst({where:{role:"CUSTOMER",email:{equals:customer.email,mode:"insensitive"}},select:{id:true}}):null;
    const issued = await prisma.$transaction(async tx=>{
      if (customerUser) await tx.customerRecord.updateMany({ where: { id: current.customerId, userId: null }, data: { userId: customerUser.id } });
      const invoice=await tx.invoice.update({
      where: { id: current.id },
      data: {
        status: "ISSUED",
        issueDate: current.issueDate ?? new Date(),
        issuedSnapshot: {
          business: {
            name: businessSettingsSchema.parse(business.settings ?? {}).branding.displayName || business.tradingName || business.name,
            phone: business.phone,
            email: business.email,
            address: business.address,
            paymentInstructions: businessSettingsSchema.parse(business.settings ?? {}).payments.instructionsEnabled ? business.paymentInstructions : null,
            branding: businessSettingsSchema.parse(business.settings ?? {}).branding,
          },
          taxLabel: businessSettingsSchema.parse(business.settings ?? {}).tax.label,
          customer: {
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            billingAddress: customer.billingAddress,
          },
          totals: {
            subtotal: current.subtotal.toString(),
            discount: current.discount.toString(),
            tax: current.tax.toString(),
            grandTotal: current.grandTotal.toString(),
          },
        },
      },
    });
      await queueNotificationEvent(tx,{businessId:membership.businessId,actorUserId:req.user!.id,idempotencyKey:`invoice-issued:${invoice.id}`,eventType:"INVOICE_ISSUED",payload:{reference:invoice.invoiceNumber,name:customer.name,amount:Number(invoice.grandTotal),currency:invoice.currency,customerFacing:true,actionUrl:"/customer/invoices",...(customerUser?{recipientUserIds:[customerUser.id]}:{})}});
      return invoice;
    });
    res.json({ invoice: issued });
  } catch (error) { next(error); }
});
app.post("/api/invoices/:id/cancel", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await providerMembership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const current = await prisma.invoice.findFirst({ where: { id: String(req.params.id), businessId: membership.businessId }, include: { payments: true, customer: { select: { id: true, name: true, email: true, phone: true } } } });
    if (!current) return res.status(404).json({ error: "Invoice not found" });
    if (current.status === "PAID" || current.payments.length) return res.status(409).json({ error: "Invoices with recorded payments cannot be cancelled" });
    if (current.status === "CANCELLED") return res.status(409).json({ error: "Invoice is already cancelled" });
    const customerUser = current.customer.email || current.customer.phone ? await prisma.user.findFirst({ where: { OR: [...(current.customer.email ? [{ email: current.customer.email }] : []), ...(current.customer.phone ? [{ phone: current.customer.phone }] : [])] }, select: { id: true } }) : null;
    const invoice = await prisma.$transaction(async tx => {
      const cancelled = await tx.invoice.update({ where: { id: current.id }, data: { status: "CANCELLED" }, include: invoiceInclude });
      await queueNotificationEvent(tx,{businessId:membership.businessId,actorUserId:req.user!.id,idempotencyKey:`invoice-cancelled:${current.id}`,eventType:"INVOICE_CANCELLED",payload:{reference:current.invoiceNumber,name:current.customer.name,customerFacing:true,actionUrl:"/customer/invoices",...(customerUser?{recipientUserIds:[customerUser.id]}:{})}});
      return cancelled;
    });
    res.json({ invoice });
  } catch (error) { next(error); }
});
app.post("/api/invoices/:id/payments", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const input = z.object({ amount: z.coerce.number().positive().max(100000000), method: paymentMethodEnum, paymentDate: z.coerce.date().optional(), reference: z.string().trim().max(120).optional(), notes: z.string().trim().max(1000).optional() }).strict().parse(req.body);
    const methodConfig = await prisma.business.findUniqueOrThrow({where:{id:membership.businessId},select:{settings:true}}).then(row=>businessSettingsSchema.parse(row.settings??{}));
    if(!methodConfig.payments.enabledMethods.includes(input.method))return res.status(400).json({error:"This payment method is disabled in business settings"});
    const amountCents = moneyCents(input.amount);
    const invoiceId = String(req.params.id);
    const result = await prisma.$transaction(async (tx) => {
      const invoiceRows = await tx.$queryRaw<Array<{ id: string; businessId: string; customerId: string; invoiceNumber: string; currency: string; grandTotal: string; amountPaid: string; status: string }>>`
        SELECT id, "businessId", "customerId", "invoiceNumber", currency, "grandTotal", "amountPaid", status FROM "Invoice"
        WHERE id = ${invoiceId} AND "businessId" = ${membership.businessId}
        FOR UPDATE
      `;
      const invoice = invoiceRows[0];
      if (!invoice) throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
      if (["DRAFT", "CANCELLED"].includes(invoice.status)) throw Object.assign(new Error("Payments can only be recorded against issued invoices"), { statusCode: 409 });
      const existingPaid = Number(invoice.amountPaid ?? 0);
      const totalCents = moneyCents(Number(invoice.grandTotal));
      const paidCents = moneyCents(existingPaid);
      if (amountCents <= 0 || paidCents + amountCents > totalCents) throw Object.assign(new Error("Payment cannot exceed the outstanding balance"), { statusCode: 400 });
      const payment = await tx.payment.create({ data: { businessId: membership.businessId, invoiceId: invoice.id, amount: centsMoney(amountCents), paymentDate: input.paymentDate ?? new Date(), method: input.method, reference: input.reference, notes: input.notes, recordedById: req.user!.id } });
      const newPaid = paidCents + amountCents;
      const status = newPaid >= totalCents ? "PAID" : "PARTIALLY_PAID";
      const updatedInvoice = await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: centsMoney(newPaid), status } });
      const customer=await tx.customerRecord.findUnique({where:{id:invoice.customerId},select:{name:true,email:true,phone:true}});
      const customerUser=customer?.email||customer?.phone?await tx.user.findFirst({where:{role:"CUSTOMER",OR:[...(customer.email?[{email:customer.email}]:[]),...(customer.phone?[{phone:customer.phone}]:[])]},select:{id:true}}):null;
      await queueNotificationEvent(tx,{businessId:membership.businessId,actorUserId:req.user!.id,idempotencyKey:`invoice-payment:${payment.id}`,eventType:status==="PAID"?"INVOICE_PAID":"INVOICE_PARTIALLY_PAID",payload:{reference:invoice.invoiceNumber,name:customer?.name??"Customer",amount:Number(payment.amount),currency:invoice.currency,customerFacing:true,actionUrl:"/customer/invoices",...(customerUser?{recipientUserIds:[customerUser.id]}:{})}});
      return { payment, invoice: updatedInvoice };
    }, { isolationLevel: "Serializable" });
    res.status(201).json(result);
  } catch (error) { next(error); }
});
app.get("/api/invoices/:id/pdf", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await providerMembership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const invoice = await prisma.invoice.findFirst({ where: { id: String(req.params.id), businessId: membership.businessId, status: { not: "DRAFT" } }, include: invoiceInclude });
    if (!invoice) return res.status(404).json({ error: "Issued invoice not found" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
    doc.pipe(res);
    const color = invoice.currency === "KES" ? "KES" : invoice.currency;
    const fmt = (amount: unknown) => `${color} ${Number(amount).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const snapshot = z.object({ business: z.object({ name: z.string(), phone: z.string(), email: z.string().nullable().optional(), address: z.string().nullable().optional(), paymentInstructions: z.string().nullable().optional() }), customer: z.object({ name: z.string(), phone: z.string(), email: z.string().nullable().optional(), billingAddress: z.string().nullable().optional() }) }).passthrough().safeParse(invoice.issuedSnapshot);
    const business = snapshot.success ? snapshot.data.business : invoice.business;
    const customer = snapshot.success ? snapshot.data.customer : invoice.customer;
    const snapshotBusiness=snapshot.success?snapshot.data.business as typeof snapshot.data.business & {branding?:unknown}:null;
    const branding = snapshotBusiness?.branding && typeof snapshotBusiness.branding === "object" ? brandingSettingsSchema.parse(snapshotBusiness.branding) : businessSettingsSchema.parse(invoice.business.settings??{}).branding;
    doc.fontSize(20).fillColor(branding.secondaryColor).text(business.name, { continued: true }).fontSize(11).fillColor(branding.primaryColor).text("INVOICE", { align: "right" });
    doc.moveDown(0.3).fontSize(9).fillColor("#52616b").text([business.phone, business.email, business.address].filter(Boolean).join(" · "));
    doc.moveDown(1).fontSize(17).fillColor("#163d52").text(invoice.invoiceNumber);
    doc.fontSize(10).fillColor("#293943").text(`Issued: ${invoice.issueDate?.toLocaleDateString() ?? "—"}     Due: ${invoice.dueDate?.toLocaleDateString() ?? "—"}`);
    doc.moveDown().fontSize(9).text("BILL TO", { continued: false }).fontSize(12).text(customer.name).fontSize(10).text([customer.phone, customer.email, customer.billingAddress].filter(Boolean).join(" · "));
    if (invoice.quotation) doc.moveDown(0.5).text(`Source quotation: ${invoice.quotation.quotationNumber}`);
    doc.moveDown(1.4);
    const columns = [48, 315, 375, 435, 510];
    const heading = () => { const y = doc.y; doc.fontSize(9).fillColor("#52616b").text("DESCRIPTION", columns[0], y, { width: 250 }).text("QTY", columns[1], y, { width: 45, align: "right" }).text("UNIT", columns[2], y, { width: 50, align: "right" }).text("PRICE", columns[3], y, { width: 68, align: "right" }).text("TOTAL", columns[4], y, { width: 48, align: "right" }); doc.moveDown(0.7); doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor("#d9e1e5").stroke(); doc.moveDown(0.5); };
    heading();
    for (const item of invoice.items) {
      if (doc.y > 710) { doc.addPage(); heading(); }
      const y = doc.y; doc.fontSize(9).fillColor("#293943").text(item.description, columns[0], y, { width: 250 }).text(String(item.quantity), columns[1], y, { width: 45, align: "right" }).text(item.unit, columns[2], y, { width: 50, align: "right" }).text(fmt(item.unitPrice), columns[3], y, { width: 68, align: "right" }).text(fmt(item.lineTotal), columns[4], y, { width: 48, align: "right" }); doc.moveDown(Math.max(0.65, Math.ceil(doc.heightOfString(item.description, { width: 250 }) / 12) * 0.7));
    }
    if (doc.y > 650) doc.addPage();
    doc.moveDown().fontSize(10).fillColor("#293943");
    const taxLabel=snapshot.success&&typeof snapshot.data.taxLabel==="string"?snapshot.data.taxLabel:"Tax";
    for (const [label, amount] of [["Subtotal", invoice.subtotal], ["Discount", invoice.discount], [taxLabel, invoice.tax], ["Total", invoice.grandTotal], ["Paid", invoice.amountPaid], ["Balance due", Number(invoice.grandTotal) - Number(invoice.amountPaid)]] as const) doc.text(label, 350, doc.y, { continued: true }).text(fmt(amount), { align: "right" });
    if (business.paymentInstructions || invoice.paymentTerms || invoice.notes) { doc.moveDown().fontSize(9).fillColor("#52616b"); if (business.paymentInstructions) doc.text(`Payment instructions: ${business.paymentInstructions}`); if (invoice.paymentTerms) doc.text(`Payment terms: ${invoice.paymentTerms}`); if (invoice.notes) doc.text(`Notes: ${invoice.notes}`); }
    if(branding.footer)doc.moveDown().fontSize(8).fillColor(branding.secondaryColor).text(branding.footer,{align:"center"});
    doc.end();
  } catch (error) {
    next(error);
  }
});
// ── RESTORED: quotation sharing/PDF, billing, jobs, inventory, payments, expenses, reports ──
const pdfBuffer = (draw: (document: PDFKit.PDFDocument) => void) =>
  new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ margin: 48 });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    draw(document);
    document.end();
  });

const sharedQuotation = async (token: string) =>
  prisma.quotationShare.findFirst({
    where: { tokenHash: tokenHash(token), revokedAt: null, expiresAt: { gt: new Date() } },
    include: {
      quotation: {
        include: { items: { orderBy: { sortOrder: "asc" } }, business: true, customer: true },
      },
    },
  });
app.get(
  "/api/quotations/share/:token",
  rateLimit("share", 30, 15 * 60 * 1000),
  async (req, res, next) => {
    try {
      const share = await sharedQuotation(String(req.params.token));
      if (!share) return res.status(404).json({ error: "Share link is invalid or expired" });
      const { quotation } = share;
      res.json({
        quotation: {
          id: quotation.id,
          quotationNumber: quotation.quotationNumber,
          revision: quotation.revision,
          title: quotation.title,
          description: quotation.description,
          location: quotation.location,
          currency: quotation.currency,
          issueDate: quotation.issueDate,
          expiryDate: quotation.expiryDate,
          subtotal: quotation.subtotal,
          discount: quotation.discount,
          tax: quotation.tax,
          grandTotal: quotation.grandTotal,
          terms: quotation.terms,
          paymentTerms: quotation.paymentTerms,
          status: quotation.status,
          items: quotation.items,
          business: {
            name: quotation.business.name,
            phone: quotation.business.phone,
            email: quotation.business.email,
            address: quotation.business.address,
          },
          customer: { name: quotation.customer.name },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/quotations/share/:token/respond",
  rateLimit("share-response", 10, 15 * 60 * 1000),
  async (req, res, next) => {
    try {
      const input = z.object({ decision: z.enum(["ACCEPTED", "REJECTED"]) }).parse(req.body);
      const share = await sharedQuotation(String(req.params.token));
      if (!share) return res.status(404).json({ error: "Share link is invalid or expired" });
      const result = await prisma.$transaction(async tx=>{
        const updated=await tx.quotation.updateMany({where:{id:share.quotation.id,status:"ISSUED"},data:{status:input.decision}});
        if(updated.count)await queueNotificationEvent(tx,{businessId:share.quotation.businessId,idempotencyKey:`quotation-response:${share.quotation.id}:${input.decision}`,eventType:input.decision==="ACCEPTED"?"QUOTATION_ACCEPTED":"QUOTATION_REJECTED",payload:{reference:share.quotation.quotationNumber,name:share.quotation.customer.name,actionUrl:`/app/quotations/${share.quotation.id}`}});
        return updated;
      });
      if (!result.count) {
        const current = await prisma.quotation.findUnique({
          where: { id: share.quotation.id },
          select: { status: true },
        });
        return res.json({ status: current?.status ?? "UNKNOWN", alreadyResponded: true });
      }
      res.json({ status: input.decision, alreadyResponded: false });
    } catch (error) {
      next(error);
    }
  },
);
app.get(
  "/api/quotations/:id/pdf",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await providerMembership(req.user!.id);
      if (!membership) return res.status(403).json({ error: "Business membership required" });
      const quotation = await prisma.quotation.findFirst({
        where: {
          id: String(req.params.id),
          businessId: membership.businessId,
          status: { not: "DRAFT" },
        },
        include: { items: { orderBy: { sortOrder: "asc" } }, business: true, customer: true },
      });
      if (!quotation) return res.status(404).json({ error: "Issued quotation not found" });
      const quoteSnapshot=z.object({business:z.object({name:z.string().optional(),branding:z.unknown().optional()}).passthrough()}).passthrough().safeParse(quotation.issuedSnapshot);
      const documentBranding=quoteSnapshot.success&&quoteSnapshot.data.business.branding?brandingSettingsSchema.parse(quoteSnapshot.data.business.branding):businessSettingsSchema.parse(quotation.business.settings??{}).branding;
      const displayName=quoteSnapshot.success?quoteSnapshot.data.business.name||quotation.business.name:documentBranding.displayName||quotation.business.tradingName||quotation.business.name;
      const formatQuoteMoney=(amount:unknown)=>`${quotation.currency} ${Number(amount).toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
      const document = new PDFDocument({ margin: 48 });
      const chunks: Buffer[] = [];
      document.on("data", (chunk: Buffer) => chunks.push(chunk));
      document.on("end", () => {
        res
          .type("application/pdf")
          .setHeader(
            "Content-Disposition",
            `attachment; filename="${quotation.quotationNumber}.pdf"`,
          )
          .send(Buffer.concat(chunks));
      });
      document.fontSize(22).fillColor(documentBranding.secondaryColor).text(displayName);
      document
        .fontSize(10)
        .fillColor("#596a65")
        .text(
          `${quotation.business.phone}${quotation.business.email ? ` · ${quotation.business.email}` : ""}`,
        );
      document.moveDown();
      document.fontSize(18).fillColor(documentBranding.primaryColor).text(`Quotation ${quotation.quotationNumber}`);
      document.fontSize(11).text(`Customer: ${quotation.customer.name}`);
      document.text(`Title: ${quotation.title}`);
      if (quotation.location) document.text(`Location: ${quotation.location}`);
      document.moveDown();
      quotation.items.forEach((item, index) =>
        document
          .fontSize(10)
          .text(
            `${index + 1}. ${item.description} — ${item.quantity} ${item.unit} × ${formatQuoteMoney(item.unitPrice)} = ${formatQuoteMoney(item.lineTotal)}`,
          ),
      );
      document.moveDown();
      document
        .fontSize(11)
        .text(`Subtotal: ${formatQuoteMoney(quotation.subtotal)}`)
        .text(`Discount: ${formatQuoteMoney(quotation.discount)}`)
        .text(`Tax: ${formatQuoteMoney(quotation.tax)}`)
        .fontSize(14)
        .text(`Total: ${formatQuoteMoney(quotation.grandTotal)}`);
      if (quotation.terms) document.moveDown().fontSize(10).text(`Terms: ${quotation.terms}`);
      if(documentBranding.footer)document.moveDown().fontSize(8).fillColor(documentBranding.secondaryColor).text(documentBranding.footer,{align:"center"});
      document.end();
    } catch (error) {
      next(error);
    }
  },
);
const normalizeMpesaPhone = (value: string) => {
  const compact = value.replace(/[\s-]/g, "");
  if (/^07\d{8}$/.test(compact)) return `254${compact.slice(1)}`;
  if (/^2547\d{8}$/.test(compact)) return compact;
  if (/^\+2547\d{8}$/.test(compact)) return compact.slice(1);
  throw new Error("Use a valid Kenyan M-Pesa number");
};
const darajaBase = () =>
  process.env.MPESA_ENVIRONMENT === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
const billingMembership = async (userId: string) => providerMembership(userId);
const currentPlan = async () =>
  prisma.subscriptionPlan.upsert({
    where: { code: "PRO_MONTHLY" },
    create: {
      code: "PRO_MONTHLY",
      name: "Pro monthly",
      price: monthlyPrice(),
      currency: "KES",
      durationMonths: 1,
    },
    update: {},
  });
const initiateSubscriptionStk = async (transactionId: string, plan: { name: string; price: Prisma.Decimal; currency: string }, phoneNumber: string) => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY, consumerSecret = process.env.MPESA_CONSUMER_SECRET, shortcode = process.env.MPESA_SHORTCODE, passkey = process.env.MPESA_PASSKEY, callbackUrl = process.env.MPESA_CALLBACK_URL;
  if (!consumerKey || !consumerSecret || !shortcode || !passkey || !callbackUrl) throw Object.assign(new Error("M-Pesa payments are not configured yet"), { statusCode: 503 });
  const tokenResponse = await fetch(`${darajaBase()}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}` } });
  if (!tokenResponse.ok) throw Object.assign(new Error("M-Pesa authentication failed"), { statusCode: 502 });
  const token = (await tokenResponse.json() as { access_token?: string }).access_token;
  if (!token) throw Object.assign(new Error("M-Pesa authentication response was invalid"), { statusCode: 502 });
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
  const stkResponse = await fetch(`${darajaBase()}/mpesa/stkpush/v1/processrequest`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ BusinessShortCode: shortcode, Password: password, Timestamp: timestamp, TransactionType: "CustomerPayBillOnline", Amount: Number(plan.price), PartyA: phoneNumber, PartyB: shortcode, PhoneNumber: phoneNumber, CallBackURL: callbackUrl, AccountReference: `FundiQuote-${transactionId.slice(0, 8)}`, TransactionDesc: `FundiQuote ${plan.name} subscription` }) });
  const body = await stkResponse.json() as { ResponseCode?: string; ResponseDescription?: string; CheckoutRequestID?: string; MerchantRequestID?: string };
  if (!stkResponse.ok || body.ResponseCode !== "0" || !body.CheckoutRequestID) throw Object.assign(new Error(body.ResponseDescription ?? "M-Pesa could not start the payment request"), { statusCode: 502 });
  await prisma.paymentTransaction.update({ where: { id: transactionId }, data: { checkoutRequestId: body.CheckoutRequestID, merchantRequestId: body.MerchantRequestID } });
  return body;
};
const runAutomaticSubscriptionRenewals = async () => {
  const now = new Date(), windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const due = await prisma.subscription.findMany({ where: { status: "ACTIVE", autoRenew: true, cancelledAt: null, expiresAt: { gt: now, lte: windowEnd } }, orderBy: { expiresAt: "asc" }, take: 50 });
  for (const current of due) {
    if (!current.expiresAt) continue;
    const idempotencyKey = `subscription-autorenew:${current.id}:${current.expiresAt.getTime()}`;
    if (await prisma.paymentTransaction.findUnique({ where: { idempotencyKey }, select: { id: true } })) continue;
    const pending = await prisma.paymentTransaction.findFirst({ where: { businessId: current.businessId, status: "PENDING", requestedAt: { gt: new Date(now.getTime() - 10 * 60_000) } }, select: { id: true } });
    if (pending) continue;
    const [plan, previousPayment] = await Promise.all([
      prisma.subscriptionPlan.findFirst({ where: { code: current.planCode, isActive: true } }),
      prisma.paymentTransaction.findFirst({ where: { businessId: current.businessId, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, select: { phoneNumber: true } }),
    ]);
    if (!plan || !previousPayment) {
      await prisma.subscription.updateMany({ where: { id: current.id, autoRenew: true }, data: { autoRenew: false } });
      await prisma.$transaction(tx => queueNotificationEvent(tx, { businessId: current.businessId, idempotencyKey: `${idempotencyKey}:failed`, eventType: "SUBSCRIPTION_PAYMENT_FAILED", payload: { reason: "Automatic M-Pesa renewal could not start. Please renew manually.", actionUrl: "/app/billing" } }));
      continue;
    }
    const phoneNumber = previousPayment.phoneNumber;
    const created = await prisma.$transaction(async tx => {
      const subscription = await tx.subscription.create({ data: { businessId: current.businessId, planCode: plan.code, status: "PENDING", price: plan.price, currency: plan.currency, autoRenew: true } });
      const transaction = await tx.paymentTransaction.create({ data: { businessId: current.businessId, subscriptionId: subscription.id, provider: "MPESA", amount: plan.price, currency: plan.currency, phoneNumber, idempotencyKey } });
      return { subscription, transaction };
    }).catch(() => null);
    if (!created) continue;
    try {
      await initiateSubscriptionStk(created.transaction.id, plan, phoneNumber);
      await prisma.$transaction(tx => queueNotificationEvent(tx, { businessId: current.businessId, idempotencyKey: `${idempotencyKey}:started`, eventType: "SUBSCRIPTION_PAYMENT_INITIATED", payload: { plan: plan.name, phoneNumber, amount: Number(plan.price), currency: plan.currency, actionUrl: "/app/billing" } }));
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : "M-Pesa renewal prompt failed";
      await prisma.$transaction(async tx => {
        await tx.paymentTransaction.update({ where: { id: created.transaction.id }, data: { status: "FAILED", failureReason: reason } });
        await tx.subscription.update({ where: { id: created.subscription.id }, data: { status: "CANCELLED", autoRenew: false } });
        await tx.subscription.updateMany({ where: { id: current.id, status: "ACTIVE", autoRenew: true }, data: { autoRenew: false } });
        await queueNotificationEvent(tx, { businessId: current.businessId, idempotencyKey: `${idempotencyKey}:failed`, eventType: "SUBSCRIPTION_PAYMENT_FAILED", payload: { reason, actionUrl: "/app/billing" } });
      });
    }
  }
};
app.get("/api/billing/plans", async (_req, res, next) => {
  try {
    await currentPlan();
    const plans = await prisma.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: [{ durationMonths: "asc" }, { createdAt: "asc" }] });
    res.json({ plans: plans.map(plan => ({ ...plan, billingCycle: plan.durationMonths === 12 ? "ANNUAL" : plan.durationMonths === 1 ? "MONTHLY" : `${plan.durationMonths} MONTHS`, description: "Access FundiQuote business tools for your selected billing period.", features: ["Business profile", "Customer management", "Quotations", "Invoices", "Jobs", "Expenses", "Inventory", "Business reports"] })) });
  } catch (error) {
    next(error);
  }
});
app.get("/api/admin/subscription-plan", auth, role("ADMIN"), async (_req, res, next) => {
  try {
    res.json({ plan: await currentPlan() });
  } catch (error) {
    next(error);
  }
});
app.patch(
  "/api/admin/subscription-plan",
  auth,
  role("ADMIN"),
  async (req: AuthedRequest, res, next) => {
    try {
      const input = z
        .object({ price: z.coerce.number().int().positive().max(100000), currency: z.literal("KES"), limits: z.object({ customers: z.number().int().min(0).max(1000000).nullable(), quotationsPerMonth: z.number().int().min(0).max(1000000).nullable(), teamMembers: z.number().int().min(1).max(100000).nullable() }).strict().optional() })
        .strict()
        .parse(req.body);
      const plan = await currentPlan();
      const updated = await prisma.$transaction(async (tx) => {
        const saved = await tx.subscriptionPlan.update({
          where: { id: plan.id },
          data: { price: input.price, currency: input.currency, ...(input.limits ? { limits: input.limits as Prisma.InputJsonObject } : {}) },
        });
        await tx.subscriptionPlanAudit.create({
          data: {
            planId: plan.id,
            userId: req.user!.id,
            oldPrice: plan.price,
            newPrice: input.price,
            currency: input.currency,
          },
        });
        return saved;
      });
      res.json({ plan: updated });
    } catch (error) {
      next(error);
    }
  },
);
app.get("/api/billing", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await billingMembership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const subscription = await subscriptionForBusiness(membership.businessId);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const status = typeof req.query.status === "string" && ["PENDING", "COMPLETED", "FAILED", "CANCELLED", "UNKNOWN"].includes(req.query.status) ? req.query.status as "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED" | "UNKNOWN" : undefined;
    const term = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    const from = typeof req.query.from === "string" && !Number.isNaN(Date.parse(req.query.from)) ? new Date(req.query.from) : undefined;
    const to = typeof req.query.to === "string" && !Number.isNaN(Date.parse(req.query.to)) ? new Date(req.query.to) : undefined;
    const quotaMonthStart = getNairobiDayMonthBounds(new Date()).monthStart;
    const transactionWhere = { businessId: membership.businessId, ...(status ? { status } : {}), ...(from || to ? { requestedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}), ...(term ? { OR: [{ id: { contains: term, mode: "insensitive" as const } }, { phoneNumber: { contains: term, mode: "insensitive" as const } }, { mpesaReceipt: { contains: term, mode: "insensitive" as const } }, { failureReason: { contains: term, mode: "insensitive" as const } }] } : {}) };
    const [plan, transactions, total, customersUsed, quotationsUsed, teamUsed, pendingTransaction] = await Promise.all([subscription?.status === "ACTIVE" ? prisma.subscriptionPlan.findUnique({ where: { code: subscription.planCode } }) : Promise.resolve(null), prisma.paymentTransaction.findMany({
      where: transactionWhere,
      orderBy: { createdAt: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
      select: {
        id: true,
        amount: true,
        currency: true,
        provider: true,
        status: true,
        phoneNumber: true,
        mpesaReceipt: true,
        failureReason: true,
        requestedAt: true,
        completedAt: true,
      },
    }), prisma.paymentTransaction.count({ where: transactionWhere }), prisma.customerRecord.count({ where: { businessId: membership.businessId } }), prisma.quotation.count({ where: { businessId: membership.businessId, createdAt: { gte: quotaMonthStart } } }), prisma.businessMember.count({ where: { businessId: membership.businessId, status: "ACTIVE" } }), prisma.paymentTransaction.findFirst({ where: { businessId: membership.businessId, status: "PENDING" }, orderBy: { requestedAt: "desc" }, select: { id: true } })]);
    res.json({
      subscription: subscription ?? { status: "FREE", price: monthlyPrice(), currency: "KES" },
      plan,
      pendingTransactionId: pendingTransaction?.id ?? null,
      business: await prisma.business.findUnique({ where: { id: membership.businessId }, select: { id: true, name: true, phone: true, email: true } }),
      usage: { customers: { used: customersUsed, limit: plan?.limits && typeof plan.limits === "object" && !Array.isArray(plan.limits) && typeof plan.limits.customers === "number" ? plan.limits.customers : null }, quotations: { used: quotationsUsed, limit: plan?.limits && typeof plan.limits === "object" && !Array.isArray(plan.limits) && typeof plan.limits.quotationsPerMonth === "number" ? plan.limits.quotationsPerMonth : null }, teamMembers: { used: teamUsed, limit: plan?.limits && typeof plan.limits === "object" && !Array.isArray(plan.limits) && typeof plan.limits.teamMembers === "number" ? plan.limits.teamMembers : null } },
      entitlements: {
        quotations: !!(await activeSubscription(membership.businessId)),
        invoices: !!(await activeSubscription(membership.businessId)),
      },
      transactions,
      pagination: { page, pageSize, total },
    });
  } catch (error) {
    next(error);
  }
});
app.post("/api/billing/auto-renew", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const input = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    const membership = await billingMembership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const active = await prisma.subscription.findFirst({ where: { businessId: membership.businessId, status: "ACTIVE", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    if (!active) return res.status(404).json({ error: "An active subscription is required to change renewal settings" });
    if (input.enabled) {
      const paymentMethod = await prisma.paymentTransaction.findFirst({ where: { businessId: membership.businessId, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, select: { phoneNumber: true } });
      if (!paymentMethod) return res.status(409).json({ error: "Complete an M-Pesa payment first so we can use its confirmed phone number for renewal prompts" });
    }
    const subscription = await prisma.$transaction(async tx => {
      const saved = await tx.subscription.update({ where: { id: active.id }, data: { autoRenew: input.enabled, cancelledAt: null } });
      if (!input.enabled) await tx.subscription.updateMany({ where: { businessId: membership.businessId, status: "PENDING", autoRenew: true }, data: { autoRenew: false } });
      return saved;
    });
    res.json({ subscription, message: input.enabled ? "Automatic renewal prompts are on. M-Pesa will ask you to approve the payment before expiry." : "Automatic renewal prompts are off. Your current access remains active through its paid period." });
  } catch (error) { next(error); }
});
app.post(
  "/api/billing/cancel-renewal",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await billingMembership(req.user!.id);
      if (!membership) return res.status(403).json({ error: "Business membership required" });
      const now = new Date();
      const active = await prisma.subscription.findFirst({ where: { businessId: membership.businessId, status: "ACTIVE", expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
      if (!active) return res.status(404).json({ error: "There is no active subscription to cancel" });
      const updated = await prisma.$transaction(async tx => {
        const saved = await tx.subscription.update({ where: { id: active.id }, data: { autoRenew: false, cancelledAt: active.cancelledAt ?? now } });
        await tx.subscription.updateMany({ where: { businessId: membership.businessId, status: "PENDING", autoRenew: true }, data: { autoRenew: false } });
        await queueNotificationEvent(tx, { businessId: membership.businessId, actorUserId: req.user!.id, idempotencyKey: `subscription-cancelled:${active.id}`, eventType: "SUBSCRIPTION_CANCELLED", payload: { plan: active.planCode, expiresAt: active.expiresAt?.toISOString(), actionUrl: "/app/billing" } });
        return saved;
      });
      res.json({ subscription: updated, message: "Cancellation is scheduled for the end of the paid period. Access remains active until then." });
    } catch (error) { next(error); }
  },
);
app.post(
  "/api/billing/reactivate",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await billingMembership(req.user!.id);
      if (!membership) return res.status(403).json({ error: "Business membership required" });
      const active = await prisma.subscription.findFirst({ where: { businessId: membership.businessId, status: "ACTIVE", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
      if (!active) return res.status(404).json({ error: "There is no active subscription to reactivate" });
      const subscription = await prisma.subscription.update({ where: { id: active.id }, data: { cancelledAt: null, autoRenew: false } });
      res.json({ subscription, message: "The scheduled cancellation has been removed. Renewal remains manual." });
    } catch (error) { next(error); }
  },
);
app.post(
  "/api/billing/mpesa/initiate",
  auth,
  role("PROVIDER"),
  rateLimit("mpesa-initiate", 3, 15 * 60 * 1000),
  async (req: AuthedRequest, res, next) => {
    let paymentTransactionId: string | undefined;
    try {
      const membership = await billingMembership(req.user!.id);
      if (!membership) return res.status(403).json({ error: "Business membership required" });
      const input = z
        .object({ phoneNumber: z.string().min(10), planCode: z.string().trim().min(1).default("PRO_MONTHLY") })
        .strict()
        .parse(req.body);
      const plan = await prisma.subscriptionPlan.findFirst({ where: { code: input.planCode, isActive: true } });
      if (!plan) return res.status(404).json({ error: "This subscription plan is unavailable" });
      if (!Number.isInteger(Number(plan.price))) return res.status(409).json({ error: "The configured KES plan price must be a whole shilling amount for M-Pesa checkout" });
      const phoneNumber = normalizeMpesaPhone(input.phoneNumber);
      const existing = await prisma.paymentTransaction.findFirst({
        where: {
          businessId: membership.businessId,
          status: "PENDING",
          createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) },
        },
      });
      if (existing)
        return res
          .status(409)
          .json({ error: "A payment is already pending", transactionId: existing.id });
      const subscription = await prisma.subscription.create({
        data: {
          businessId: membership.businessId,
          planCode: plan.code,
          status: "PENDING",
          price: plan.price,
          currency: plan.currency,
        },
      });
      const transaction = await prisma.paymentTransaction.create({
        data: {
          businessId: membership.businessId,
          subscriptionId: subscription.id,
          provider: "MPESA",
          amount: plan.price,
          currency: plan.currency,
          phoneNumber,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      paymentTransactionId = transaction.id;
      try {
        await initiateSubscriptionStk(transaction.id, plan, phoneNumber);
      } catch (error) {
        await prisma.paymentTransaction.update({ where: { id: transaction.id }, data: { status: "FAILED", failureReason: error instanceof Error ? error.message.slice(0, 500) : "M-Pesa request failed" } });
        throw error;
      }
      await prisma.$transaction(tx => queueNotificationEvent(tx, { businessId: membership.businessId, idempotencyKey: `subscription-payment-initiated:${transaction.id}`, eventType: "SUBSCRIPTION_PAYMENT_INITIATED", payload: { plan: plan.name, phoneNumber, amount: Number(plan.price), currency: plan.currency, actionUrl: "/app/billing" } }));
      res
        .status(202)
        .json({
          transactionId: transaction.id,
          status: "PENDING",
          message: "Check your phone and enter your M-Pesa PIN to continue.",
        });
    } catch (error) {
      if (paymentTransactionId) await prisma.paymentTransaction.update({ where: { id: paymentTransactionId }, data: { status: "FAILED", failureReason: error instanceof Error ? error.message.slice(0, 500) : "M-Pesa request failed" } }).catch(() => undefined);
      next(error);
    }
  },
);
app.get(
  "/api/billing/transactions/:id",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await billingMembership(req.user!.id);
      if (!membership) return res.status(403).json({ error: "Business membership required" });
      const transaction = await prisma.paymentTransaction.findFirst({
        where: { id: String(req.params.id), businessId: membership.businessId },
        select: {
          id: true,
          status: true,
          amount: true,
          currency: true,
          mpesaReceipt: true,
          failureReason: true,
          requestedAt: true,
          completedAt: true,
        },
      });
      if (!transaction) return res.status(404).json({ error: "Payment transaction not found" });
      res.json({ transaction });
    } catch (error) {
      next(error);
    }
  },
);
app.post("/api/invoices/:id/mpesa/initiate", auth, rateLimit("invoice-mpesa", 3, 15 * 60 * 1000), async (req: AuthedRequest, res, next) => {
  let attemptId: string | undefined;
  try {
    const membership = req.user!.role === "PROVIDER" ? await phase3Membership(req.user!.id) : null;
    if (req.user!.role === "PROVIDER" && !membership) return res.status(403).json({ error: "Business membership required" });
    if (req.user!.role !== "PROVIDER" && req.user!.role !== "CUSTOMER") return res.status(403).json({ error: "Not allowed" });
    const input = z.object({ phoneNumber: z.string().min(10), amount: z.coerce.number().positive().max(100000000) }).strict().parse(req.body);
    const invoice = await prisma.invoice.findFirst({ where: { id: String(req.params.id), ...(membership ? { businessId: membership.businessId } : { customer: { userId: req.user!.id } }) } });
    if (!invoice) return res.status(404).json({ error: "Eligible invoice not found" });
    const businessId = invoice.businessId;
    const paymentSettings=await prisma.business.findUniqueOrThrow({where:{id:businessId},select:{settings:true}}).then(value=>businessSettingsSchema.parse(value.settings??{}));
    if(!paymentSettings.payments.enabledMethods.includes("MPESA"))return res.status(400).json({error:"M-Pesa is disabled in business payment settings"});
    const phoneNumber = normalizeMpesaPhone(input.phoneNumber);
    if (!invoice || ["DRAFT", "CANCELLED"].includes(invoice.status)) return res.status(404).json({ error: "Eligible invoice not found" });
    const amountCents = moneyCents(input.amount), balanceCents = moneyCents(Number(invoice.grandTotal) - Number(invoice.amountPaid));
    if (amountCents > balanceCents) return res.status(400).json({ error: "Payment cannot exceed the outstanding balance" });
    const pending = await prisma.invoiceMpesaAttempt.findFirst({ where: { invoiceId: invoice.id, status: "PENDING", requestedAt: { gt: new Date(Date.now()-10*60*1000) } } });
    if (pending) return res.status(409).json({ error: "An M-Pesa request is already pending", attemptId: pending.id });
    const attempt = await prisma.invoiceMpesaAttempt.create({ data: { businessId, invoiceId: invoice.id, recordedById: req.user!.id, amount: centsMoney(amountCents), phoneNumber, idempotencyKey: crypto.randomUUID() } });
    attemptId = attempt.id;
    const key=process.env.MPESA_CONSUMER_KEY, secret=process.env.MPESA_CONSUMER_SECRET, shortcode=process.env.MPESA_SHORTCODE, passkey=process.env.MPESA_PASSKEY, callbackUrl=process.env.MPESA_CALLBACK_URL;
    if(!key||!secret||!shortcode||!passkey||!callbackUrl) throw new Error("M-Pesa is not configured on the server");
    const authResponse=await fetch(`${darajaBase()}/oauth/v1/generate?grant_type=client_credentials`,{headers:{Authorization:`Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`}});
    if(!authResponse.ok) throw new Error("M-Pesa authentication failed");
    const token=(await authResponse.json() as {access_token?:string}).access_token;if(!token)throw new Error("M-Pesa authentication response was invalid");
    const timestamp=new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14), password=Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
    const response=await fetch(`${darajaBase()}/mpesa/stkpush/v1/processrequest`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({BusinessShortCode:shortcode,Password:password,Timestamp:timestamp,TransactionType:"CustomerPayBillOnline",Amount:Math.ceil(input.amount),PartyA:phoneNumber,PartyB:shortcode,PhoneNumber:phoneNumber,CallBackURL:callbackUrl,AccountReference:invoice.invoiceNumber,TransactionDesc:`Invoice ${invoice.invoiceNumber}`})});
    const body=await response.json() as {ResponseCode?:string;ResponseDescription?:string;CheckoutRequestID?:string;MerchantRequestID?:string};
    if(!response.ok||body.ResponseCode!=="0"||!body.CheckoutRequestID)throw new Error(body.ResponseDescription||"M-Pesa could not start the payment request");
    const updated=await prisma.invoiceMpesaAttempt.update({where:{id:attempt.id},data:{checkoutRequestId:body.CheckoutRequestID,merchantRequestId:body.MerchantRequestID}});
    res.status(201).json({attempt:updated});
  } catch(error) { if(attemptId) await prisma.invoiceMpesaAttempt.update({where:{id:attemptId},data:{status:"FAILED",failureReason:error instanceof Error?error.message:"M-Pesa request failed"}}).catch(()=>undefined); next(error); }
});
app.get("/api/invoices/:id/mpesa/attempts", auth, role("PROVIDER"), async (req:AuthedRequest,res,next)=>{try{const m=await phase3Membership(req.user!.id);if(!m)return res.status(403).json({error:"Business membership required"});const invoice=await prisma.invoice.findFirst({where:{id:String(req.params.id),businessId:m.businessId},select:{id:true}});if(!invoice)return res.status(404).json({error:"Invoice not found"});const attempts=await prisma.invoiceMpesaAttempt.findMany({where:{invoiceId:invoice.id,businessId:m.businessId},orderBy:{requestedAt:"desc"},take:20});res.json({attempts})}catch(error){next(error)}});
app.get("/api/customer-portal/invoices/:id/mpesa/attempts", auth, role("CUSTOMER"), async (req:AuthedRequest,res,next)=>{try{const invoice=await prisma.invoice.findFirst({where:{id:String(req.params.id),customer:{userId:req.user!.id}},select:{id:true,businessId:true}});if(!invoice)return res.status(404).json({error:"Invoice not found"});const attempts=await prisma.invoiceMpesaAttempt.findMany({where:{invoiceId:invoice.id,businessId:invoice.businessId},orderBy:{requestedAt:"desc"},take:20});res.json({attempts})}catch(error){next(error)}});
app.get("/api/invoice-mpesa-attempts/:id", auth, role("PROVIDER"), async(req:AuthedRequest,res,next)=>{try{const m=await phase3Membership(req.user!.id);if(!m)return res.status(403).json({error:"Business membership required"});const attempt=await prisma.invoiceMpesaAttempt.findFirst({where:{id:String(req.params.id),businessId:m.businessId}});if(!attempt)return res.status(404).json({error:"Attempt not found"});res.json({attempt})}catch(error){next(error)}});
app.post("/api/billing/mpesa/callback", async (req, res, next) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID)
      return res.status(400).json({ ResultCode: 1, ResultDesc: "Invalid callback" });
    const invoiceAttempt = await prisma.invoiceMpesaAttempt.findFirst({
      where: { checkoutRequestId: callback.CheckoutRequestID },
    });
    if (invoiceAttempt) {
      if (invoiceAttempt.status !== "PENDING") return res.json({ ResultCode: 0, ResultDesc: "Already processed" });
      const items = Array.isArray(callback.CallbackMetadata?.Item) ? callback.CallbackMetadata.Item : [];
      const value = (name: string) => items.find((item: { Name?: string }) => item.Name === name)?.Value;
      const resultCode = Number(callback.ResultCode);
      const receipt = value("MpesaReceiptNumber") ? String(value("MpesaReceiptNumber")) : undefined;
      const paidAmount = Number(value("Amount"));
      const responseDesc = String(callback.ResultDesc ?? (resultCode === 0 ? "Success" : "Payment failed"));
      await prisma.$transaction(async tx => {
        const locked = await tx.invoiceMpesaAttempt.findUnique({ where: { id: invoiceAttempt.id } });
        if (!locked || locked.status !== "PENDING") return;
        if (resultCode !== 0) {
          await tx.invoiceMpesaAttempt.update({ where: { id: locked.id }, data: { status: "FAILED", failureReason: responseDesc, callbackAt: new Date() } });
          const failedInvoice=await tx.invoice.findUnique({where:{id:locked.invoiceId},select:{invoiceNumber:true}});
          await queueNotificationEvent(tx,{businessId:locked.businessId,idempotencyKey:`mpesa-failed:${locked.id}`,eventType:"PAYMENT_FAILED",payload:{reference:failedInvoice?.invoiceNumber??locked.invoiceId,reason:responseDesc,actionUrl:`/app/invoices/${locked.invoiceId}`}});
          return;
        }
        if (!receipt || paidAmount !== Number(locked.amount)) {
          await tx.invoiceMpesaAttempt.update({ where: { id: locked.id }, data: { status: "UNKNOWN", failureReason: "Callback amount or receipt did not match the request", callbackAt: new Date() } });
          return;
        }
        const rows = await tx.$queryRaw<Array<{id:string;businessId:string;customerId:string;invoiceNumber:string;currency:string;grandTotal:string;amountPaid:string}>>`SELECT id,"businessId","customerId","invoiceNumber",currency,"grandTotal","amountPaid" FROM "Invoice" WHERE id=${locked.invoiceId} AND "businessId"=${locked.businessId} FOR UPDATE`;
        const invoice = rows[0];
        if (!invoice) throw new Error("Invoice not found for M-Pesa attempt");
        const totalCents = moneyCents(Number(invoice.grandTotal)), paidCents = moneyCents(Number(invoice.amountPaid)), amountCents = moneyCents(paidAmount);
        if (paidCents + amountCents > totalCents) {
          await tx.invoiceMpesaAttempt.update({ where: { id: locked.id }, data: { status: "UNKNOWN", failureReason: "Confirmed payment exceeds the invoice balance; manual reconciliation required", callbackAt: new Date() } });
          return;
        }
        const payment = await tx.payment.create({ data: { businessId: locked.businessId, invoiceId: locked.invoiceId, amount: centsMoney(amountCents), method: "MPESA", reference: receipt, transactionReference: receipt, mpesaReceipt: receipt, status: "SUCCESSFUL", paymentDate: new Date(), recordedById: locked.recordedById } });
        const newPaid = paidCents + amountCents;
        await tx.invoice.update({ where: { id: locked.invoiceId }, data: { amountPaid: centsMoney(newPaid), status: newPaid >= totalCents ? "PAID" : "PARTIALLY_PAID" } });
        await tx.invoiceMpesaAttempt.update({ where: { id: locked.id }, data: { status: "COMPLETED", mpesaReceipt: receipt, paymentId: payment.id, callbackAt: new Date() } });
        const customer=await tx.customerRecord.findUnique({where:{id:invoice.customerId},select:{name:true,email:true,phone:true}});
        const customerUser=customer?.email||customer?.phone?await tx.user.findFirst({where:{role:"CUSTOMER",OR:[...(customer.email?[{email:customer.email}]:[]),...(customer.phone?[{phone:customer.phone}]:[])]},select:{id:true}}):null;
        const status=newPaid>=totalCents?"INVOICE_PAID":"INVOICE_PARTIALLY_PAID";
        await queueNotificationEvent(tx,{businessId:locked.businessId,idempotencyKey:`invoice-payment:${payment.id}`,eventType:status,payload:{reference:invoice.invoiceNumber,name:customer?.name??"Customer",amount:paidAmount,currency:invoice.currency,customerFacing:true,actionUrl:"/customer/invoices",...(customerUser?{recipientUserIds:[customerUser.id]}:{})}});
      });
      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }
    const transaction = await prisma.paymentTransaction.findFirst({
      where: { checkoutRequestId: callback.CheckoutRequestID },
      include: { subscription: true },
    });
    if (!transaction) return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    if (transaction.status !== "PENDING")
      return res.json({ ResultCode: 0, ResultDesc: "Already processed" });
    const items = Array.isArray(callback.CallbackMetadata?.Item)
      ? callback.CallbackMetadata.Item
      : [];
    const value = (name: string) =>
      items.find((item: { Name?: string }) => item.Name === name)?.Value;
    const resultCode = Number(callback.ResultCode);
    const receipt = value("MpesaReceiptNumber") ? String(value("MpesaReceiptNumber")) : undefined;
    const amount = Number(value("Amount"));
    await prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM "PaymentTransaction" WHERE id=${transaction.id} FOR UPDATE`;
      if (!lockedRows[0] || lockedRows[0].status !== "PENDING") return;
      await tx.paymentEvent.create({
        data: {
          transactionId: transaction.id,
          eventType: resultCode === 0 ? "SUCCESS" : "FAILURE",
          resultCode,
          payload: {
            resultCode,
            receipt: receipt ?? null,
            amount: Number.isFinite(amount) ? amount : null,
          },
        },
      });
      if (resultCode !== 0) {
        await tx.paymentTransaction.update({
          where: { id: transaction.id },
          data: {
            status: "FAILED",
            failureReason: String(callback.ResultDesc ?? "Payment failed"),
            callbackAt: new Date(),
          },
        });
        await tx.subscription.update({ where: { id: transaction.subscriptionId }, data: { status: "CANCELLED", autoRenew: false } });
        if (transaction.subscription.autoRenew) await tx.subscription.updateMany({ where: { businessId: transaction.businessId, status: "ACTIVE", autoRenew: true }, data: { autoRenew: false } });
        await queueNotificationEvent(tx,{businessId:transaction.businessId,idempotencyKey:`subscription-payment-failed:${transaction.id}`,eventType:"SUBSCRIPTION_PAYMENT_FAILED",payload:{reason:String(callback.ResultDesc??"Payment failed"),amount:Number(transaction.amount),currency:transaction.currency,actionUrl:"/app/billing"}});
        return;
      }
      if (amount !== Number(transaction.amount) || !receipt) {
        await tx.paymentTransaction.update({
          where: { id: transaction.id },
          data: {
            status: "UNKNOWN",
            failureReason: "Payment amount or receipt did not match the pending transaction",
            callbackAt: new Date(),
          },
        });
        return;
      }
      const duplicateReceipt = await tx.paymentTransaction.findFirst({
        where: { mpesaReceipt: receipt, NOT: { id: transaction.id } },
      });
      if (duplicateReceipt) {
        await tx.paymentTransaction.update({
          where: { id: transaction.id },
          data: {
            status: "UNKNOWN",
            failureReason: "Receipt already belongs to another transaction",
            callbackAt: new Date(),
          },
        });
        return;
      }
      const startsAt = new Date();
      const current = await tx.subscription.findFirst({ where: { businessId: transaction.businessId, status: "ACTIVE", expiresAt: { gt: startsAt } }, orderBy: { expiresAt: "desc" } });
      const plan = await tx.subscriptionPlan.findFirst({ where: { code: transaction.subscription.planCode } });
      const billingMonths = Math.max(1, plan?.durationMonths ?? 1);
      const renewalBase = current?.expiresAt && current.expiresAt > startsAt ? current.expiresAt : startsAt;
      const expiresAt = addCalendarMonths(renewalBase, billingMonths);
      await tx.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: "COMPLETED",
          mpesaReceipt: receipt,
          callbackAt: new Date(),
          completedAt: new Date(),
        },
      });
      await tx.subscription.update({
        where: { id: transaction.subscriptionId },
        data: { status: "ACTIVE", startsAt: current?.startsAt ?? startsAt, expiresAt, price: transaction.amount, currency: transaction.currency },
      });
      if (current && current.id !== transaction.subscriptionId) await tx.subscription.update({ where: { id: current.id }, data: { status: "EXPIRED" } });
      await queueNotificationEvent(tx,{businessId:transaction.businessId,idempotencyKey:`subscription-activated:${transaction.id}`,eventType:"SUBSCRIPTION_ACTIVATED",payload:{plan:transaction.subscription.planCode,expiresAt:expiresAt.toISOString(),amount:Number(transaction.amount),currency:transaction.currency,actionUrl:"/app/billing"}});
    });
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    next(error);
  }
});
const phase3Membership = async (userId: string) => providerMembership(userId);
app.get("/api/jobs/stats", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const [grouped, startingThisWeek, completedThisMonth] = await prisma.$transaction([
      prisma.job.groupBy({
        by: ["status"],
        orderBy: { status: "asc" },
        where: { businessId: membership.businessId },
        _count: { _all: true },
      }),
      prisma.job.count({
        where: {
          businessId: membership.businessId,
          status: "SCHEDULED",
          scheduledStart: { gte: weekStart, lt: weekEnd },
        },
      }),
      prisma.job.count({
        where: {
          businessId: membership.businessId,
          status: "COMPLETED",
          completedAt: { gte: monthStart, lt: nextMonth },
        },
      }),
    ]);
    const byStatus = Object.fromEntries(
      grouped.map((row) => [row.status, typeof row._count === "object" ? Number(row._count._all ?? 0) : 0]),
    );
    const total = grouped.reduce(
      (sum, row) => sum + (typeof row._count === "object" ? Number(row._count._all ?? 0) : 0),
      0,
    );
    res.json({
      total,
      byStatus,
      active: (byStatus.SCHEDULED ?? 0) + (byStatus.IN_PROGRESS ?? 0) + (byStatus.ON_HOLD ?? 0),
      startingThisWeek,
      inProgress: byStatus.IN_PROGRESS ?? 0,
      completedThisMonth,
    });
  } catch (error) {
    next(error);
  }
});
const jobStatusTransitions: Record<string, string[]> = {
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["IN_PROGRESS", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};
const phase3JobInput = z
  .object({
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().max(3000).optional(),
    location: z.string().trim().max(240).optional(),
    scheduledStart: z.coerce.date().optional(),
    expectedCompletion: z.coerce.date().optional(),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
    internalNotes: z.string().trim().max(3000).optional(),
  })
  .strict();
app.get("/api/jobs", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const query = z
      .object({
        status: z
          .enum(["SCHEDULED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"])
          .optional(),
        search: z.string().trim().max(80).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(req.query);
    const where = {
      businessId: membership.businessId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: "insensitive" as const } },
              { jobNumber: { contains: query.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [jobs, total] = await prisma.$transaction([
      prisma.job.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          customer: true,
          quotation: { select: { quotationNumber: true, grandTotal: true } },
        },
      }),
      prisma.job.count({ where }),
    ]);
    res.json({ jobs, page: query.page, pageSize: query.pageSize, total });
  } catch (error) {
    next(error);
  }
});
app.post(
  "/api/quotations/:id/convert-to-job",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await phase3Membership(req.user!.id);
      if (!membership) return res.status(403).json({ error: "Business membership required" });
      const input = phase3JobInput.parse(req.body);
      const result = await prisma.$transaction(async (tx) => {
        const quotation = await tx.quotation.findFirst({
          where: {
            id: String(req.params.id),
            businessId: membership.businessId,
            status: "ACCEPTED",
          },
          include: { customer: true },
        });
        if (!quotation)
          throw Object.assign(new Error("Only accepted quotations can become jobs"), {
            status: 409,
          });
        const existing = await tx.job.findUnique({ where: { quotationId: quotation.id } });
        if (existing) return existing;
        const business = await tx.business.findUniqueOrThrow({where:{id:membership.businessId},select:{settings:true}});
        const jobNumber = await nextDocumentNumber(tx,membership.businessId,"job",businessSettingsSchema.parse(business.settings??{}));
        const job = await tx.job.create({
          data: {
            businessId: membership.businessId,
            customerId: quotation.customerId,
            quotationId: quotation.id,
            jobNumber,
            ...input,
            activities: {
              create: {
                userId: req.user!.id,
                type: "CREATED",
                message: "Job created from accepted quotation",
              },
            },
          },
          include: { customer: true, quotation: true },
        });
        await queueNotificationEvent(tx,{businessId:membership.businessId,actorUserId:req.user!.id,idempotencyKey:`job-created:${job.id}`,eventType:"JOB_CREATED",payload:{reference:job.jobNumber,name:job.customer.name,actionUrl:`/app/jobs/${job.id}`}});
        return job;
      });
      res.status(201).json({ job: result });
    } catch (error) {
      next(error);
    }
  },
);
app.get("/api/jobs/:id", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const job = await prisma.job.findFirst({
      where: { id: String(req.params.id), businessId: membership.businessId },
      include: {
        customer: true,
        quotation: { include: { items: true } },
        activities: {
          orderBy: { createdAt: "desc" },
          include: { user: { select: { fullName: true } } },
        },
        materialsUsed: { include: { material: true } },
        invoices: { include: { payments: true } },
        expenses: true,
      },
    });
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json({ job });
  } catch (error) {
    next(error);
  }
});
app.patch("/api/jobs/:id/status", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const input = z
      .object({ status: z.enum(["SCHEDULED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"]) })
      .parse(req.body);
    const job = await prisma.job.findFirst({
      where: { id: String(req.params.id), businessId: membership.businessId },
    });
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (!jobStatusTransitions[job.status].includes(input.status))
      return res
        .status(409)
        .json({
          error: `Cannot change a ${job.status.toLowerCase()} job to ${input.status.toLowerCase()}`,
        });
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.job.update({
        where: { id: job.id },
        data: {
          status: input.status,
          ...(input.status === "IN_PROGRESS" && !job.actualStart
            ? { actualStart: new Date() }
            : {}),
          ...(input.status === "COMPLETED" ? { completedAt: new Date() } : {}),
        },
      });
      await tx.jobActivity.create({
        data: {
          jobId: job.id,
          userId: req.user!.id,
          type: "STATUS_CHANGED",
          message: `${job.status} → ${input.status}`,
        },
      });
      const jobCustomer=input.status==="COMPLETED"?await tx.customerRecord.findUnique({where:{id:job.customerId},select:{email:true,phone:true}}):null;
      const customerUser=jobCustomer?.email||jobCustomer?.phone?await tx.user.findFirst({where:{role:"CUSTOMER",OR:[...(jobCustomer.email?[{email:jobCustomer.email}]:[]),...(jobCustomer.phone?[{phone:jobCustomer.phone}]:[])]},select:{id:true}}):null;
      await queueNotificationEvent(tx,{businessId:membership.businessId,actorUserId:req.user!.id,idempotencyKey:`job-status:${job.id}:${input.status}`,eventType:input.status==="COMPLETED"?"JOB_COMPLETED":"JOB_STATUS_CHANGED",payload:{reference:job.jobNumber,name:job.title,status:input.status,customerFacing:Boolean(customerUser&&input.status==="COMPLETED"),actionUrl:customerUser&&input.status==="COMPLETED"?"/customer/jobs":`/app/jobs/${job.id}`,...(customerUser&&input.status==="COMPLETED"?{recipientUserIds:[customerUser.id]}:{})}});
      return saved;
    });
    res.json({ job: updated });
  } catch (error) {
    next(error);
  }
});
const materialInput = z
  .object({
    sku: z.string().trim().max(40).optional(),
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(1000).optional(),
    category: z.string().trim().max(80).optional(),
    unit: z.string().trim().min(1).max(30),
    costPerUnit: z.coerce.number().nonnegative(),
    sellingPrice: z.coerce.number().nonnegative().optional(),
    reorderLevel: z.coerce.number().nonnegative().default(0),
    supplier: z.string().trim().max(160).optional(),
  })
  .strict();
app.get("/api/materials", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const materials = await prisma.material.findMany({
      where: {
        businessId: membership.businessId,
        ...(req.query.search
          ? { name: { contains: String(req.query.search), mode: "insensitive" as const } }
          : {}),
      },
      orderBy: { name: "asc" },
    });
    res.json({ materials });
  } catch (error) {
    next(error);
  }
});
app.post("/api/materials", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const input = materialInput.parse(req.body);
    const material = await prisma.material.create({
      data: { ...input, businessId: membership.businessId },
    });
    res.status(201).json({ material });
  } catch (error) {
    next(error);
  }
});
app.get("/api/materials/:id", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const material = await prisma.material.findFirst({
      where: { id: String(req.params.id), businessId: membership.businessId },
      include: {
        movements: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            job: { select: { id: true, jobNumber: true, title: true } },
            createdBy: { select: { fullName: true } },
          },
        },
        jobUsages: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { job: { select: { id: true, jobNumber: true, title: true, status: true } } },
        },
      },
    });
    if (!material) return res.status(404).json({ error: "Inventory item not found" });
    res.json({ material });
  } catch (error) {
    next(error);
  }
});
app.patch("/api/materials/:id", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const input = materialInput.partial().parse(req.body);
    const result = await prisma.material.updateMany({
      where: { id: String(req.params.id), businessId: membership.businessId },
      data: input,
    });
    if (!result.count) return res.status(404).json({ error: "Inventory item not found" });
    const material = await prisma.material.findFirst({
      where: { id: String(req.params.id), businessId: membership.businessId },
    });
    res.json({ material });
  } catch (error) {
    next(error);
  }
});
app.post(
  "/api/materials/:id/restock",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await phase3Membership(req.user!.id);
      if (!membership) return res.status(403).json({ error: "Business membership required" });
      const input = z
        .object({
          quantity: z.coerce.number().positive(),
          reason: z.string().trim().max(300).optional(),
          reference: z.string().trim().max(120).optional(),
          costPerUnit: z.coerce.number().nonnegative().optional(),
        })
        .strict()
        .parse(req.body);
      const material = await prisma.material.findFirst({
        where: { id: String(req.params.id), businessId: membership.businessId },
      });
      if (!material) return res.status(404).json({ error: "Material not found" });
      const updated = await prisma.$transaction(async (tx) => {
        const movement = await tx.stockMovement.create({
          data: {
            businessId: membership.businessId,
            materialId: material.id,
            type: "PURCHASE",
            quantity: input.quantity,
            costPerUnit: input.costPerUnit ?? material.costPerUnit,
            reason: input.reason,
            reference: input.reference,
            createdById: req.user!.id,
          },
        });
        const updatedMaterial = await tx.material
          .update({
            where: { id: material.id },
            data: {
              stockQuantity: { increment: input.quantity },
              ...(input.costPerUnit !== undefined ? { costPerUnit: input.costPerUnit } : {}),
            },
          });
        if(Number(material.stockQuantity)<=Number(material.reorderLevel)&&Number(updatedMaterial.stockQuantity)>Number(material.reorderLevel))await queueNotificationEvent(tx,{businessId:membership.businessId,actorUserId:req.user!.id,idempotencyKey:`inventory-restocked:${movement.id}`,eventType:"INVENTORY_RESTOCKED",payload:{name:material.name,quantity:Number(updatedMaterial.stockQuantity),actionUrl:"/app/inventory"}});
        return { material: updatedMaterial, movement };
      });
      res.status(201).json(updated);
    } catch (error) {
      next(error);
    }
  },
);
app.get("/api/stock-movements", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        materialId: z.string().uuid().optional(),
      })
      .parse(req.query);
    const where = {
      businessId: membership.businessId,
      ...(query.materialId ? { materialId: query.materialId } : {}),
    };
    const [movements, total] = await prisma.$transaction([
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          material: { select: { id: true, name: true, unit: true } },
          job: { select: { id: true, jobNumber: true } },
          createdBy: { select: { fullName: true } },
        },
      }),
      prisma.stockMovement.count({ where }),
    ]);
    res.json({
      movements,
      page: query.page,
      pageSize: query.pageSize,
      total,
      pageCount: Math.ceil(total / query.pageSize),
    });
  } catch (error) {
    next(error);
  }
});
const stockChangeInput = z
  .object({
    quantity: z.coerce.number().positive(),
    reason: z.string().trim().min(2).max(300),
    reference: z.string().trim().max(120).optional(),
  })
  .strict();
app.post(
  "/api/materials/:id/adjustments",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await phase3Membership(req.user!.id);
      if (!membership) return res.status(403).json({ error: "Business membership required" });
      const input = z
        .object({
          delta: z.coerce.number().refine((value) => value !== 0),
          reason: z.string().trim().min(2).max(300),
          reference: z.string().trim().max(120).optional(),
        })
        .strict()
        .parse(req.body);
      const material = await prisma.material.findFirst({
        where: { id: String(req.params.id), businessId: membership.businessId },
      });
      if (!material) return res.status(404).json({ error: "Inventory item not found" });
      const amount = Math.abs(input.delta);
      const result = await prisma.$transaction(async (tx) => {
        const changed = await tx.material.updateMany({
          where: {
            id: material.id,
            businessId: membership.businessId,
            ...(input.delta < 0 ? { stockQuantity: { gte: amount } } : {}),
          },
          data: { stockQuantity: input.delta < 0 ? { decrement: amount } : { increment: amount } },
        });
        if (!changed.count)
          throw Object.assign(new Error("Adjustment would make stock negative"), { status: 409 });
        const movement = await tx.stockMovement.create({
          data: {
            businessId: membership.businessId,
            materialId: material.id,
            type: "ADJUSTMENT",
            quantity: amount,
            costPerUnit: material.costPerUnit,
            reason: `${input.delta < 0 ? "Stock decrease" : "Stock increase"}: ${input.reason}`,
            reference: input.reference,
            createdById: req.user!.id,
          },
        });
        const updated = await tx.material.findUniqueOrThrow({ where: { id: material.id } });
        if(input.delta<0&&Number(material.stockQuantity)>Number(material.reorderLevel)&&Number(updated.stockQuantity)<=Number(material.reorderLevel))await queueNotificationEvent(tx,{businessId:membership.businessId,actorUserId:req.user!.id,idempotencyKey:`inventory-threshold:${movement.id}`,eventType:Number(updated.stockQuantity)<=0?"INVENTORY_OUT_OF_STOCK":"INVENTORY_LOW_STOCK",payload:{name:material.name,quantity:Number(updated.stockQuantity),actionUrl:"/app/inventory"}});
        return { material: updated, movement };
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/materials/:id/returns",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await phase3Membership(req.user!.id);
      if (!membership) return res.status(403).json({ error: "Business membership required" });
      const input = stockChangeInput.parse(req.body);
      const material = await prisma.material.findFirst({
        where: { id: String(req.params.id), businessId: membership.businessId },
      });
      if (!material) return res.status(404).json({ error: "Inventory item not found" });
      const result = await prisma.$transaction(async (tx) => {
        const movement = await tx.stockMovement.create({
          data: {
            businessId: membership.businessId,
            materialId: material.id,
            type: "RETURN",
            quantity: input.quantity,
            costPerUnit: material.costPerUnit,
            reason: input.reason,
            reference: input.reference,
            createdById: req.user!.id,
          },
        });
        const updated = await tx.material.update({
          where: { id: material.id },
          data: { stockQuantity: { increment: input.quantity } },
        });
        if(Number(material.stockQuantity)<=Number(material.reorderLevel)&&Number(updated.stockQuantity)>Number(material.reorderLevel))await queueNotificationEvent(tx,{businessId:membership.businessId,actorUserId:req.user!.id,idempotencyKey:`inventory-restocked:${movement.id}`,eventType:"INVENTORY_RESTOCKED",payload:{name:material.name,quantity:Number(updated.stockQuantity),actionUrl:"/app/inventory"}});
        return { material: updated, movement };
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/jobs/:id/materials",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await phase3Membership(req.user!.id);
      if (!membership) return res.status(403).json({ error: "Business membership required" });
      const input = z
        .object({
          materialId: z.string().uuid(),
          quantity: z.coerce.number().positive(),
          reason: z.string().trim().max(300).optional(),
        })
        .strict()
        .parse(req.body);
      const result = await prisma.$transaction(async (tx) => {
        const job = await tx.job.findFirst({
          where: {
            id: String(req.params.id),
            businessId: membership.businessId,
            status: { not: "CANCELLED" },
          },
        });
        const material = await tx.material.findFirst({
          where: { id: input.materialId, businessId: membership.businessId },
        });
        if (!job || !material)
          throw Object.assign(new Error("Job or material not found"), { status: 404 });
        if (Number(material.stockQuantity) < input.quantity)
          throw Object.assign(new Error("Insufficient stock"), { status: 409 });
        const movement = await tx.stockMovement.create({
          data: {
            businessId: membership.businessId,
            materialId: material.id,
            jobId: job.id,
            type: "CONSUMPTION",
            quantity: input.quantity,
            costPerUnit: material.costPerUnit,
            reason: input.reason,
            createdById: req.user!.id,
          },
        });
        await tx.material.update({
          where: { id: material.id },
          data: { stockQuantity: { decrement: input.quantity } },
        });
        const updatedMaterial=await tx.material.findUniqueOrThrow({where:{id:material.id}});
        if(Number(material.stockQuantity)>Number(material.reorderLevel)&&Number(updatedMaterial.stockQuantity)<=Number(material.reorderLevel))await queueNotificationEvent(tx,{businessId:membership.businessId,actorUserId:req.user!.id,idempotencyKey:`inventory-threshold:${movement.id}`,eventType:Number(updatedMaterial.stockQuantity)<=0?"INVENTORY_OUT_OF_STOCK":"INVENTORY_LOW_STOCK",payload:{name:material.name,quantity:Number(updatedMaterial.stockQuantity),actionUrl:"/app/inventory"}});
        return tx.jobMaterialUsage.create({
          data: {
            jobId: job.id,
            materialId: material.id,
            movementId: movement.id,
            quantity: input.quantity,
            costPerUnit: material.costPerUnit,
          },
          include: { material: true },
        });
      });
      res.status(201).json({ usage: result });
    } catch (error) {
      next(error);
    }
  },
);
app.get("/api/payments/stats", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const now = new Date();
    const today = getNairobiDayMonthBounds(now);
    const thisMonth = getNairobiDayMonthBounds(now);
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonth = getNairobiDayMonthBounds(lastMonthDate);
    const [receivedToday, receivedThisMonth, paymentsThisMonth, receivedLastMonth, byMethodThisMonthRows, countByMethod] = await prisma.$transaction([
      prisma.payment.aggregate({
        where: { businessId: membership.businessId, paymentDate: { gte: today.dayStart, lte: today.dayEnd } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { businessId: membership.businessId, paymentDate: { gte: thisMonth.monthStart, lte: thisMonth.monthEnd } },
        _sum: { amount: true },
      }),
      prisma.payment.count({
        where: { businessId: membership.businessId, paymentDate: { gte: thisMonth.monthStart, lte: thisMonth.monthEnd } },
      }),
      prisma.payment.aggregate({
        where: { businessId: membership.businessId, paymentDate: { gte: lastMonth.monthStart, lte: lastMonth.monthEnd } },
        _sum: { amount: true },
      }),
      prisma.payment.groupBy({
        by: ["method"],
        orderBy: { method: "asc" },
        where: { businessId: membership.businessId, paymentDate: { gte: thisMonth.monthStart, lte: thisMonth.monthEnd } },
        _sum: { amount: true },
      }),
      prisma.payment.groupBy({
        by: ["method"],
        orderBy: { method: "asc" },
        where: { businessId: membership.businessId },
        _count: { _all: true },
      }),
    ]);
    const byMethodThisMonth: Record<string, number> = { MPESA: 0, CASH: 0, BANK_TRANSFER: 0, OTHER: 0 };
    for (const item of byMethodThisMonthRows ?? []) {
      const method = String(item.method);
      if (method in byMethodThisMonth) {
        byMethodThisMonth[method] = Number(item._sum?.amount ?? 0);
      }
    }
    const countByMethodObj: Record<string, number> = { ALL: 0, MPESA: 0, CASH: 0, BANK_TRANSFER: 0, OTHER: 0 };
    countByMethodObj.ALL = await prisma.payment.count({ where: { businessId: membership.businessId } });
    for (const item of countByMethod ?? []) {
      const method = String(item.method);
      if (method in countByMethodObj) {
        const count = typeof item._count === "object" ? Number(item._count._all ?? 0) : 0;
        countByMethodObj[method] = count;
      }
    }
    const receivedThisMonthTotal = Number(receivedThisMonth._sum.amount ?? 0);
    res.json({
      receivedToday: Number(receivedToday._sum.amount ?? 0),
      receivedThisMonth: receivedThisMonthTotal,
      paymentsThisMonth: paymentsThisMonth,
      receivedLastMonth: Number(receivedLastMonth._sum.amount ?? 0),
      averagePaymentThisMonth: paymentsThisMonth > 0 ? receivedThisMonthTotal / paymentsThisMonth : 0,
      byMethodThisMonth: {
        MPESA: byMethodThisMonth.MPESA,
        CASH: byMethodThisMonth.CASH,
        BANK_TRANSFER: byMethodThisMonth.BANK_TRANSFER,
        OTHER: byMethodThisMonth.OTHER,
      },
      countByMethod: {
        ALL: countByMethodObj.ALL,
        MPESA: countByMethodObj.MPESA,
        CASH: countByMethodObj.CASH,
        BANK_TRANSFER: countByMethodObj.BANK_TRANSFER,
        OTHER: countByMethodObj.OTHER,
      },
    });
  } catch (error) {
    next(error);
  }
});
app.get("/api/payments", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const query = z.object({
      search: z.string().trim().max(80).optional(),
      method: paymentMethodEnum.optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      invoiceId: z.string().uuid().optional(),
      customerId: z.string().uuid().optional(),
      sort: paymentSortEnum.default("newest"),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
    }).parse(req.query);
    const where: any = { businessId: membership.businessId };
    if (query.search) {
      where.OR = [
        { reference: { contains: query.search, mode: "insensitive" } },
        { invoice: { invoiceNumber: { contains: query.search, mode: "insensitive" } } },
        { invoice: { customer: { name: { contains: query.search, mode: "insensitive" } } } },
      ];
    }
    if (query.method) where.method = query.method;
    if (query.invoiceId) where.invoiceId = query.invoiceId;
    if (query.customerId) where.invoice = { customerId: query.customerId };
    if (query.from || query.to) {
      where.paymentDate = {};
      if (query.from) where.paymentDate.gte = new Date(`${query.from}T00:00:00+03:00`);
      if (query.to) where.paymentDate.lte = new Date(`${query.to}T23:59:59.999+03:00`);
    }
    const orderBy = query.sort === "oldest" ? { paymentDate: "asc" as const } : query.sort === "amount" ? { amount: "desc" as const } : { paymentDate: "desc" as const };
    const [payments, total, summary] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy,
        include: {
          recordedBy: { select: { fullName: true } },
          invoice: { select: { id: true, invoiceNumber: true, grandTotal: true, amountPaid: true, status: true, customer: { select: { id: true, name: true, phone: true } } } },
        },
      }),
      prisma.payment.count({ where }),
      prisma.payment.aggregate({ where, _sum: { amount: true } }),
    ]);
    const documentSettings=await prisma.business.findUniqueOrThrow({where:{id:membership.businessId},select:{settings:true}}).then(value=>businessSettingsSchema.parse(value.settings??{}));
    const serialised = payments.map((payment) => ({
      ...payment,
      amount: Number(payment.amount),
      receiptNumber: configuredReceiptNumber(payment.id,documentSettings),
      invoice: payment.invoice ? { ...payment.invoice, grandTotal: Number(payment.invoice.grandTotal), amountPaid: Number(payment.invoice.amountPaid) } : null,
      recordedBy: payment.recordedBy ? { fullName: payment.recordedBy.fullName } : null,
    }));
    res.json({ payments: serialised, page: query.page, pageSize: query.pageSize, total, filteredTotal: Number(summary._sum.amount ?? 0) });
  } catch (error) {
    next(error);
  }
});
const expenseInput = z
  .object({
    jobId: z.string().uuid().optional(),
    category: z.enum([
      "MATERIALS",
      "TRANSPORT",
      "LABOUR",
      "TOOLS",
      "UTILITIES",
      "RENT",
      "MAINTENANCE",
      "OTHER",
    ]),
    description: z.string().trim().min(2).max(240),
    amount: z.coerce.number().positive(),
    expenseDate: z.coerce.date().default(new Date()),
    method: z.enum(["CASH", "BANK_TRANSFER", "MPESA", "OTHER"]).optional(),
    supplier: z.string().trim().max(160).optional(),
    reference: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
app.get("/api/expenses", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const query = z.object({ search: z.string().trim().max(100).optional(), category: z.enum(["MATERIALS","TRANSPORT","LABOUR","TOOLS","UTILITIES","RENT","MAINTENANCE","OTHER"]).optional(), jobId: z.string().uuid().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), sort: z.enum(["date","amount","title"]).default("date") }).strict().parse(req.query);
    const where: any = { businessId: membership.businessId };
    if (query.search) where.OR = [{ description: { contains: query.search, mode: "insensitive" } }, { supplier: { contains: query.search, mode: "insensitive" } }, { reference: { contains: query.search, mode: "insensitive" } }];
    if (query.category) where.category = query.category;
    if (query.jobId) where.jobId = query.jobId;
    if (query.from || query.to) where.expenseDate = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
    const orderBy = query.sort === "amount" ? { amount: "desc" as const } : query.sort === "title" ? { description: "asc" as const } : { expenseDate: "desc" as const };
    const expenses = await prisma.expense.findMany({
      where,
      orderBy,
      include: { job: { select: { id: true, jobNumber: true, title: true } }, recordedBy: { select: { fullName: true } } },
    });
    res.json({ expenses });
  } catch (error) {
    next(error);
  }
});
app.post("/api/expenses", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const input = expenseInput.parse(req.body);
    if (
      input.jobId &&
      !(await prisma.job.findFirst({
        where: { id: input.jobId, businessId: membership.businessId },
      }))
    )
      return res.status(404).json({ error: "Job not found" });
    const currency=await prisma.business.findUniqueOrThrow({where:{id:membership.businessId},select:{currency:true}}).then(value=>value.currency);
    const expense = await prisma.$transaction(async tx=>{
      const created=await tx.expense.create({data:{...input,currency,businessId:membership.businessId,recordedById:req.user!.id}});
      await queueNotificationEvent(tx,{businessId:membership.businessId,actorUserId:req.user!.id,idempotencyKey:`expense-recorded:${created.id}`,eventType:"EXPENSE_RECORDED",payload:{description:created.description,amount:Number(created.amount),currency:created.currency,actionUrl:"/app/expenses"}});
      return created;
    });
    res.status(201).json({ expense });
  } catch (error) {
    next(error);
  }
});
app.patch("/api/expenses/:id", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const current = await prisma.expense.findFirst({ where: { id: String(req.params.id), businessId: membership.businessId } });
    if (!current) return res.status(404).json({ error: "Expense not found" });
    const input = expenseInput.partial().strict().parse(req.body);
    if (input.jobId && !(await prisma.job.findFirst({ where: { id: input.jobId, businessId: membership.businessId } }))) return res.status(404).json({ error: "Job not found" });
    const expense = await prisma.$transaction(async tx => {
      const updated = await tx.expense.update({ where: { id: current.id }, data: input, include: { job: { select: { id: true, jobNumber: true, title: true } } } });
      if(Object.keys(input).length)await queueNotificationEvent(tx,{businessId:membership.businessId,actorUserId:req.user!.id,idempotencyKey:`expense-updated:${current.id}:${current.updatedAt.getTime()}`,eventType:"EXPENSE_UPDATED",payload:{description:updated.description,amount:Number(updated.amount),currency:updated.currency,actionUrl:"/app/expenses"}});
      return updated;
    });
    res.json({ expense });
  } catch (error) { next(error); }
});
app.delete("/api/expenses/:id", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const expense = await prisma.expense.findFirst({ where: { id: String(req.params.id), businessId: membership.businessId } });
    if (!expense) return res.status(404).json({ error: "Expense not found" });
    await prisma.expense.delete({ where: { id: expense.id } });
    res.status(204).end();
  } catch (error) { next(error); }
});
app.get("/api/reports/overview", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const end = req.query.to ? new Date(String(req.query.to)) : new Date();
    const start = req.query.from
      ? new Date(String(req.query.from))
      : new Date(end.getFullYear(), end.getMonth(), 1);
    const [jobs, invoices, payments, expenses, lowStock] = await prisma.$transaction([
      prisma.job.groupBy({
        by: ["status"],
        orderBy: { status: "asc" },
        where: { businessId: membership.businessId, createdAt: { gte: start, lte: end } },
        _count: true,
      }),
      prisma.invoice.aggregate({
        where: {
          businessId: membership.businessId,
          issueDate: { gte: start, lte: end },
          status: { not: "CANCELLED" },
        },
        _sum: { grandTotal: true, amountPaid: true },
      }),
      prisma.payment.aggregate({
        where: { businessId: membership.businessId, paymentDate: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: { businessId: membership.businessId, expenseDate: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      prisma.material.findMany({
        where: { businessId: membership.businessId, isActive: true },
        select: { id: true, name: true, stockQuantity: true, reorderLevel: true },
      }),
    ]);
    res.json({
      period: { start, end },
      jobs,
      invoicedAmount: invoices._sum.grandTotal ?? 0,
      paymentsReceived: payments._sum.amount ?? 0,
      recordedExpenses: expenses._sum.amount ?? 0,
      outstandingBalance:
        Number(invoices._sum.grandTotal ?? 0) - Number(invoices._sum.amountPaid ?? 0),
      lowStock: lowStock.filter(
        (material) => Number(material.stockQuantity) <= Number(material.reorderLevel),
      ),
    });
  } catch (error) {
    next(error);
  }
});
app.get("/api/reports/analytics", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const filters = z.object({ from: z.string().date().optional(), to: z.string().date().optional(), customerId: z.string().uuid().optional(), jobStatus: z.enum(["SCHEDULED","IN_PROGRESS","ON_HOLD","COMPLETED","CANCELLED"]).optional(), method: paymentMethodEnum.optional(), expenseCategory: z.enum(["MATERIALS","TRANSPORT","LABOUR","TOOLS","UTILITIES","RENT","MAINTENANCE","OTHER"]).optional() }).strict().parse(req.query);
    const now = new Date();
    const end = filters.to ? new Date(`${filters.to}T23:59:59.999+03:00`) : now;
    const start = filters.from ? new Date(`${filters.from}T00:00:00.000+03:00`) : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1) - 3 * 60 * 60 * 1000);
    const invoiceWhere: any = { businessId: membership.businessId, status: { notIn: ["DRAFT", "CANCELLED"] }, issueDate: { gte: start, lte: end }, ...(filters.customerId ? { customerId: filters.customerId } : {}) };
    const paymentWhere: any = { businessId: membership.businessId, status: "SUCCESSFUL", paymentDate: { gte: start, lte: end }, ...(filters.method ? { method: filters.method } : {}), ...(filters.customerId ? { invoice: { customerId: filters.customerId } } : {}) };
    const expenseWhere: any = { businessId: membership.businessId, expenseDate: { gte: start, lte: end }, ...(filters.expenseCategory ? { category: filters.expenseCategory } : {}), ...(filters.customerId ? { job: { customerId: filters.customerId } } : {}) };
    const [business, invoices, invoiceRows, payments, paymentMethods, expenses, expenseCategories, jobs, customers, agingInvoices, materials, attempts] = await prisma.$transaction([
      prisma.business.findUniqueOrThrow({ where: { id: membership.businessId }, select: { name: true, currency: true, phone: true, email: true } }),
      prisma.invoice.aggregate({ where: invoiceWhere, _sum: { grandTotal: true, amountPaid: true }, _count: { _all: true }, _avg: { grandTotal: true } }),
      prisma.invoice.findMany({ where: { businessId: membership.businessId, ...(filters.customerId ? { customerId: filters.customerId } : {}) }, select: { id:true, invoiceNumber:true, customerId:true, grandTotal:true, amountPaid:true, status:true, issueDate:true, dueDate:true, customer:{select:{name:true}} }, orderBy:{issueDate:"desc"}, take:500 }),
      prisma.payment.aggregate({ where: paymentWhere, _sum: { amount: true }, _count: { _all: true } }),
      prisma.payment.groupBy({ by: ["method"], where: paymentWhere, _sum: { amount: true }, _count: { _all: true }, orderBy: { _sum: { amount: "desc" } } }),
      prisma.expense.aggregate({ where: expenseWhere, _sum: { amount: true }, _count: { _all: true } }),
      prisma.expense.groupBy({ by: ["category"], where: expenseWhere, _sum: { amount: true }, _count: { _all: true }, orderBy:{_sum:{amount:"desc"}} }),
      prisma.job.findMany({ where: { businessId: membership.businessId, ...(filters.customerId?{customerId:filters.customerId}:{}), ...(filters.jobStatus?{status:filters.jobStatus}:{}) }, include:{customer:{select:{id:true,name:true}},invoices:{select:{id:true,grandTotal:true,amountPaid:true,status:true}},expenses:{select:{amount:true}}}, orderBy:{createdAt:"desc"}, take:500 }),
      prisma.customerRecord.findMany({ where:{businessId:membership.businessId,...(filters.customerId?{id:filters.customerId}:{})}, select:{id:true,name:true,invoices:{where:{status:{notIn:["DRAFT","CANCELLED"]}},select:{grandTotal:true,amountPaid:true}}}, take:500 }),
      prisma.invoice.findMany({ where:{businessId:membership.businessId,status:{notIn:["DRAFT","CANCELLED"]},dueDate:{lt:now},...(filters.customerId?{customerId:filters.customerId}:{})},select:{id:true,invoiceNumber:true,customer:{select:{id:true,name:true}},grandTotal:true,amountPaid:true,dueDate:true} }),
      prisma.material.findMany({where:{businessId:membership.businessId,isActive:true},select:{id:true,name:true,category:true,stockQuantity:true,reorderLevel:true,costPerUnit:true}}),
      prisma.invoiceMpesaAttempt.groupBy({by:["status"],where:{businessId:membership.businessId,requestedAt:{gte:start,lte:end}},_count:{_all:true},_sum:{amount:true},orderBy:{_count:{status:"desc"}}}),
    ]);
    const receivableInvoices=invoiceRows.filter(i=>i.status!=="DRAFT"&&i.status!=="CANCELLED"&&Number(i.grandTotal)>Number(i.amountPaid));
    const outstanding=receivableInvoices.reduce((s,i)=>s+Math.max(0,Number(i.grandTotal)-Number(i.amountPaid)),0);
    const aging={current:0,days1to30:0,days31to60:0,days61to90:0,over90:0};
    for(const i of agingInvoices){const bal=Math.max(0,Number(i.grandTotal)-Number(i.amountPaid));if(!bal||!i.dueDate)continue;const days=Math.floor((now.getTime()-i.dueDate.getTime())/86400000);if(days<=0)aging.current+=bal;else if(days<=30)aging.days1to30+=bal;else if(days<=60)aging.days31to60+=bal;else if(days<=90)aging.days61to90+=bal;else aging.over90+=bal;}
    const customerRows=customers.map(c=>({id:c.id,name:c.name,invoiced:c.invoices.reduce((s,i)=>s+Number(i.grandTotal),0),paid:c.invoices.reduce((s,i)=>s+Number(i.amountPaid),0),invoices:c.invoices.length})).sort((a,b)=>b.invoiced-a.invoiced).slice(0,20);
    const jobRows=jobs.map(j=>{const invoiced=j.invoices.filter(i=>i.status!=="CANCELLED").reduce((s,i)=>s+Number(i.grandTotal),0);const collected=j.invoices.reduce((s,i)=>s+Number(i.amountPaid),0);const costs=j.expenses.reduce((s,e)=>s+Number(e.amount),0);return{id:j.id,jobNumber:j.jobNumber,title:j.title,status:j.status,customer:j.customer.name,invoiced,collected,directCosts:costs,estimatedGrossMargin:invoiced-costs}});
    const todayStart=new Date(new Date().toLocaleString("en-US",{timeZone:"Africa/Nairobi"}));todayStart.setHours(0,0,0,0);
    res.json({business,period:{start,end},methodology:{invoiced:"Issued and partially or fully paid invoices by issue date; drafts and cancelled excluded.",collections:"Successful customer invoice payments by payment date; subscription transactions excluded.",expenses:"Recorded expense date, whether or not supplier cash settlement is tracked.",jobs:"Job list and job status counts cover all business jobs, independent of the selected financial date range.",profit:"Estimated gross margin = invoiced job value minus recorded job expenses; not audited accounting profit."},overview:{invoiced:Number(invoices._sum.grandTotal??0),collected:Number(payments._sum.amount??0),outstanding,expenses:Number(expenses._sum.amount??0),estimatedGrossProfit:Number(invoices._sum.grandTotal??0)-Number(expenses._sum.amount??0),activeJobs:jobs.filter(j=>["SCHEDULED","IN_PROGRESS","ON_HOLD"].includes(j.status)).length,completedJobs:jobs.filter(j=>j.status==="COMPLETED").length,invoiceCount:invoices._count._all,averageInvoice:Number(invoices._avg.grandTotal??0),paymentCount:payments._count._all,todayStart},paymentMethods:paymentMethods.map(x=>({method:x.method,amount:aggregateNumber(x._sum,"amount"),count:aggregateNumber(x._count,"_all")})),expenseCategories:expenseCategories.map(x=>({category:x.category,amount:aggregateNumber(x._sum,"amount"),count:aggregateNumber(x._count,"_all")})),aging,customers:customerRows,jobs:jobRows,inventory:{itemCount:materials.length,lowStock:materials.filter(m=>Number(m.stockQuantity)<=Number(m.reorderLevel)).length,outOfStock:materials.filter(m=>Number(m.stockQuantity)<=0).length,estimatedValue:materials.reduce((s,m)=>s+Number(m.stockQuantity)*Number(m.costPerUnit),0),items:materials},invoiceStatuses:{issued:invoiceRows.filter(i=>i.status==="ISSUED").length,partial:invoiceRows.filter(i=>i.status==="PARTIALLY_PAID").length,paid:invoiceRows.filter(i=>i.status==="PAID").length,overdue:agingInvoices.length},mpesaAttempts:attempts.map(a=>({status:a.status,count:aggregateNumber(a._count,"_all"),amount:aggregateNumber(a._sum,"amount")}))});
  } catch(error) { next(error); }
});
const reportRange = (query: Record<string, unknown>) => {
  const parsed = z.object({ from: z.string().date().optional(), to: z.string().date().optional() }).parse(query);
  const end = parsed.to ? new Date(`${parsed.to}T23:59:59.999+03:00`) : new Date();
  const start = parsed.from ? new Date(`${parsed.from}T00:00:00.000+03:00`) : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1) - 3 * 60 * 60 * 1000);
  if (start > end) throw Object.assign(new Error("Start date must be before end date"), { statusCode: 400 });
  return { start, end };
};
const aggregateNumber = (aggregate: unknown, key: string): number => {
  if (!aggregate || typeof aggregate !== "object") return 0;
  const value = (aggregate as Record<string, unknown>)[key];
  return typeof value === "number" || typeof value === "string" ? Number(value) || 0 : 0;
};
app.get("/api/reports/trends", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const { start, end } = reportRange(req.query as Record<string, unknown>);
    const [invoices, payments, expenses] = await prisma.$transaction([
      prisma.invoice.findMany({ where: { businessId: membership.businessId, issueDate: { gte: start, lte: end }, status: { notIn: ["DRAFT", "CANCELLED"] } }, select: { issueDate: true, grandTotal: true } }),
      prisma.payment.findMany({ where: { businessId: membership.businessId, paymentDate: { gte: start, lte: end }, status: "SUCCESSFUL" }, select: { paymentDate: true, amount: true } }),
      prisma.expense.findMany({ where: { businessId: membership.businessId, expenseDate: { gte: start, lte: end } }, select: { expenseDate: true, amount: true } }),
    ]);
    const buckets = new Map<string, { invoiced: number; collected: number; expenses: number }>();
    const keyFor = (date: Date) => {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit" }).formatToParts(date);
      return `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}`;
    };
    const get = (date: Date) => { const key = keyFor(date); let row = buckets.get(key); if (!row) { row = { invoiced: 0, collected: 0, expenses: 0 }; buckets.set(key, row); } return row; };
    invoices.forEach(row => { if (row.issueDate) get(row.issueDate).invoiced += Number(row.grandTotal); });
    payments.forEach(row => { get(row.paymentDate).collected += Number(row.amount); });
    expenses.forEach(row => { get(row.expenseDate).expenses += Number(row.amount); });
    const cursor = new Date(start);
    cursor.setUTCDate(1);
    while (cursor <= end) {
      get(cursor);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    const trend = [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([month, values]) => ({ month, ...values }));
    const duration = end.getTime() - start.getTime() + 1;
    const previousStart = new Date(start.getTime() - duration), previousEnd = new Date(start.getTime() - 1);
    const [prevInvoice, prevPayment, prevExpense] = await prisma.$transaction([
      prisma.invoice.aggregate({ where: { businessId: membership.businessId, issueDate: { gte: previousStart, lte: previousEnd }, status: { notIn: ["DRAFT", "CANCELLED"] } }, _sum: { grandTotal: true } }),
      prisma.payment.aggregate({ where: { businessId: membership.businessId, paymentDate: { gte: previousStart, lte: previousEnd }, status: "SUCCESSFUL" }, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { businessId: membership.businessId, expenseDate: { gte: previousStart, lte: previousEnd } }, _sum: { amount: true } }),
    ]);
    res.json({ trend, comparison: { current: { invoiced: invoices.reduce((s, x) => s + Number(x.grandTotal), 0), collected: payments.reduce((s, x) => s + Number(x.amount), 0), expenses: expenses.reduce((s, x) => s + Number(x.amount), 0) }, previous: { start: previousStart, end: previousEnd, invoiced: Number(prevInvoice._sum.grandTotal ?? 0), collected: Number(prevPayment._sum.amount ?? 0), expenses: Number(prevExpense._sum.amount ?? 0) } } });
  } catch (error) { next(error); }
});
app.get("/api/reports/details/:kind", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const query = z.object({ from: z.string().date().optional(), to: z.string().date().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), materialId: z.string().uuid().optional() }).parse(req.query);
    const { start, end } = reportRange({ from: query.from, to: query.to });
    const skip = (query.page - 1) * query.pageSize;
    let rows: unknown[]; let total: number;
    if (req.params.kind === "invoices") {
      const where = { businessId: membership.businessId, issueDate: { gte: start, lte: end }, status: { notIn: ["DRAFT", "CANCELLED"] as ("DRAFT" | "CANCELLED")[] } };
      [rows, total] = await prisma.$transaction([prisma.invoice.findMany({ where, orderBy: { issueDate: "desc" }, skip, take: query.pageSize, include: { customer: { select: { name: true } } } }), prisma.invoice.count({ where })]);
    } else if (req.params.kind === "payments") {
      const where = { businessId: membership.businessId, paymentDate: { gte: start, lte: end }, status: "SUCCESSFUL" as const };
      [rows, total] = await prisma.$transaction([prisma.payment.findMany({ where, orderBy: { paymentDate: "desc" }, skip, take: query.pageSize, include: { invoice: { select: { id: true, invoiceNumber: true, customer: { select: { name: true } } } } } }), prisma.payment.count({ where })]);
    } else if (req.params.kind === "expenses") {
      const where = { businessId: membership.businessId, expenseDate: { gte: start, lte: end } };
      [rows, total] = await prisma.$transaction([prisma.expense.findMany({ where, orderBy: { expenseDate: "desc" }, skip, take: query.pageSize, include: { job: { select: { id: true, jobNumber: true } } } }), prisma.expense.count({ where })]);
    } else if (req.params.kind === "inventory-movements") {
      const where = { businessId: membership.businessId, createdAt: { gte: start, lte: end }, ...(query.materialId ? { materialId: query.materialId } : {}) };
      const [movementRows, count, grouped] = await prisma.$transaction([
        prisma.stockMovement.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: query.pageSize, include: { material: { select: { id: true, name: true, unit: true } }, job: { select: { id: true, jobNumber: true } }, createdBy: { select: { fullName: true } } } }),
        prisma.stockMovement.count({ where }),
        prisma.stockMovement.groupBy({ by: ["type"], where, _sum: { quantity: true }, _count: { _all: true }, orderBy: { _count: { type: "desc" } } }),
      ]);
      rows = movementRows; total = count;
      res.json({ rows, page: query.page, pageSize: query.pageSize, total, pageCount: Math.ceil(total / query.pageSize), movementSummary: grouped.map(item => ({ type: item.type, quantity: aggregateNumber(item._sum,"quantity"), count: aggregateNumber(item._count,"_all") })) });
      return;
    } else return res.status(404).json({ error: "Unknown report detail type" });
    res.json({ rows, page: query.page, pageSize: query.pageSize, total, pageCount: Math.ceil(total / query.pageSize) });
  } catch (error) { next(error); }
});
app.get("/api/reports/export.pdf", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const { start, end } = reportRange(req.query as Record<string, unknown>);
    const [business, invoice, payment, expense, movements] = await prisma.$transaction([
      prisma.business.findUniqueOrThrow({ where: { id: membership.businessId }, select: { name: true, currency: true } }),
      prisma.invoice.aggregate({ where: { businessId: membership.businessId, issueDate: { gte: start, lte: end }, status: { notIn: ["DRAFT", "CANCELLED"] } }, _sum: { grandTotal: true }, _count: true }),
      prisma.payment.aggregate({ where: { businessId: membership.businessId, paymentDate: { gte: start, lte: end }, status: "SUCCESSFUL" }, _sum: { amount: true }, _count: true }),
      prisma.expense.aggregate({ where: { businessId: membership.businessId, expenseDate: { gte: start, lte: end } }, _sum: { amount: true }, _count: true }),
      prisma.stockMovement.count({ where: { businessId: membership.businessId, createdAt: { gte: start, lte: end } } }),
    ]);
    const money = (value: unknown) => `${business.currency} ${Number(value ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const buffer = await pdfBuffer(document => {
      document.fontSize(21).fillColor("#13212b").text(business.name).moveDown(0.25).fontSize(16).text("Business report");
      document.fontSize(10).fillColor("#53636c").text(`Period: ${start.toISOString().slice(0,10)} to ${end.toISOString().slice(0,10)}`).moveDown();
      document.fontSize(12).fillColor("#13212b").text("Financial summary").moveDown(0.4).fontSize(10);
      document.text(`Invoiced: ${money(invoice._sum.grandTotal)} (${invoice._count} invoices)`);
      document.text(`Collected: ${money(payment._sum.amount)} (${payment._count} successful payments)`);
      document.text(`Expenses recorded: ${money(expense._sum.amount)} (${expense._count} entries)`);
      document.text(`Estimated gross profit: ${money(Number(invoice._sum.grandTotal ?? 0) - Number(expense._sum.amount ?? 0))}`);
      document.text(`Inventory movements: ${movements}`).moveDown().fontSize(9).fillColor("#53636c").text("Estimated gross profit is invoiced value less recorded expenses; it is not audited accounting profit.");
    });
    res.type("application/pdf").setHeader("Content-Disposition", `attachment; filename="business-report-${start.toISOString().slice(0,10)}.pdf"`).send(buffer);
  } catch (error) { next(error); }
});
const reportScheduleInput = z.object({ name: z.string().trim().min(2).max(80), from: z.string().date(), to: z.string().date(), frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).nullable().default(null) }).strict();
const nextReportRun = (frequency: "DAILY" | "WEEKLY" | "MONTHLY", from = new Date()) => {
  const next = new Date(from);
  if (frequency === "DAILY") next.setUTCDate(next.getUTCDate() + 1);
  else if (frequency === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7);
  else {
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const finalDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, finalDay));
  }
  next.setUTCHours(5, 0, 0, 0); // 08:00 Africa/Nairobi (UTC+3)
  return next;
};
app.get("/api/reports/saved", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const reports = await prisma.savedReport.findMany({ where: { businessId: membership.businessId }, orderBy: { createdAt: "desc" } });
    res.json({ reports });
  } catch (error) { next(error); }
});
app.post("/api/reports/saved", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const input = reportScheduleInput.parse(req.body);
    const { start, end } = reportRange({ from: input.from, to: input.to });
    const report = await prisma.savedReport.create({ data: { businessId: membership.businessId, createdById: req.user!.id, name: input.name, filters: { from: input.from, to: input.to }, frequency: input.frequency, nextRunAt: input.frequency ? nextReportRun(input.frequency) : null } });
    res.status(201).json({ report, selectedPeriod: { start, end } });
  } catch (error) { next(error); }
});
app.delete("/api/reports/saved/:id", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await phase3Membership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const deleted = await prisma.savedReport.deleteMany({ where: { id: String(req.params.id), businessId: membership.businessId } });
    if (!deleted.count) return res.status(404).json({ error: "Saved report not found" });
    res.status(204).end();
  } catch (error) { next(error); }
});
app.get(
  "/api/payments/:id/receipt.pdf",
  auth,
  role("PROVIDER"),
  async (req: AuthedRequest, res, next) => {
    try {
      const membership = await phase3Membership(req.user!.id);
      if (!membership) return res.status(403).json({ error: "Business membership required" });
      const payment = await prisma.payment.findFirst({
        where: { id: String(req.params.id), businessId: membership.businessId },
        include: { business: true, invoice: { include: { customer: true } } },
      });
      if (!payment) return res.status(404).json({ error: "Payment not found" });
      const documentSettings=businessSettingsSchema.parse(payment.business.settings??{});
      const buffer = await pdfBuffer((document) => {
        document.fontSize(22).fillColor(documentSettings.branding.secondaryColor).text(documentSettings.branding.displayName||payment.business.tradingName||payment.business.name);
        document.fontSize(18).text(`Payment receipt`);
        document
          .fontSize(11)
          .text(`Receipt: ${configuredReceiptNumber(payment.id,documentSettings)}`)
          .text(`Invoice: ${payment.invoice.invoiceNumber}`)
          .text(`Customer: ${payment.invoice.customer.name}`)
          .text(`Date: ${payment.paymentDate.toISOString().slice(0, 10)}`)
          .text(`Method: ${payment.method}`)
          .text(`Reference: ${payment.reference ?? "Not provided"}`)
          .moveDown()
          .fontSize(16)
          .text(`Amount received: KES ${payment.amount}`)
          .fontSize(10)
          .text("Manual business payment record; not independently verified by a payment provider.")
          .text(
            `Remaining balance: KES ${(Number(payment.invoice.grandTotal) - Number(payment.invoice.amountPaid)).toFixed(2)}`,
          );
      });
      res
        .type("application/pdf")
        .setHeader("Content-Disposition", `attachment; filename="receipt-${payment.id}.pdf"`)
        .send(buffer);
    } catch (error) {
      next(error);
    }
  },
);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
  if (statusCode !== 500)
    return res
      .status(statusCode)
      .json({ error: error instanceof Error ? error.message : "Request failed" });
  if (error instanceof z.ZodError)
    return res.status(400).json({
      error: "Please correct the highlighted fields",
      fields: error.flatten().fieldErrors,
    });
  console.error(
    "[api] request failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

const runDueSavedReports = async () => {
  const now = new Date();
  const due = await prisma.savedReport.findMany({ where: { enabled: true, frequency: { not: null }, nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: 25 });
  for (const report of due) {
    const nextRunAt = nextReportRun(report.frequency!, now);
    const claim = await prisma.savedReport.updateMany({ where: { id: report.id, enabled: true, nextRunAt: { lte: now } }, data: { nextRunAt } });
    if (!claim.count) continue;
    try {
      const filters = report.filters as { from?: string; to?: string };
      const configuredStart = filters.from ? new Date(`${filters.from}T00:00:00.000+03:00`) : new Date(now.getTime() - 30 * 86400000);
      const configuredEnd = filters.to ? new Date(`${filters.to}T23:59:59.999+03:00`) : now;
      const span = Math.max(86400000, configuredEnd.getTime() - configuredStart.getTime() + 1);
      const end = now, start = new Date(end.getTime() - span);
      const [invoice, payment, expense, movements] = await prisma.$transaction([
        prisma.invoice.aggregate({ where: { businessId: report.businessId, issueDate: { gte: start, lte: end }, status: { notIn: ["DRAFT", "CANCELLED"] } }, _sum: { grandTotal: true }, _count: true }),
        prisma.payment.aggregate({ where: { businessId: report.businessId, paymentDate: { gte: start, lte: end }, status: "SUCCESSFUL" }, _sum: { amount: true }, _count: true }),
        prisma.expense.aggregate({ where: { businessId: report.businessId, expenseDate: { gte: start, lte: end } }, _sum: { amount: true }, _count: true }),
        prisma.stockMovement.count({ where: { businessId: report.businessId, createdAt: { gte: start, lte: end } } }),
      ]);
      await prisma.savedReport.update({ where: { id: report.id }, data: { lastRunAt: now, lastResult: { period: { start, end }, invoiced: Number(invoice._sum.grandTotal ?? 0), invoices: invoice._count, collected: Number(payment._sum.amount ?? 0), payments: payment._count, expenses: Number(expense._sum.amount ?? 0), expenseEntries: expense._count, inventoryMovements: movements } } });
    } catch (error) {
      console.error(`[reports] scheduled report ${report.id} failed`, error instanceof Error ? error.message : "Unknown error");
    }
  }
};

if (require.main === module) {
  const server = app.listen(port, () =>
    console.log(`FundiQuote API listening on ${port}`),
  );
  const reportTimer = setInterval(() => { void runDueSavedReports().catch(error => console.error("[reports] schedule worker failed", error instanceof Error ? error.message : "Unknown error")); }, 60_000);
  const notificationTimer = setInterval(() => { void processNotificationQueue(prisma).catch(error => console.error("[notifications] worker failed", error instanceof Error ? error.message : "Unknown error")); }, 5_000);
  const notificationCleanupTimer = setInterval(() => { void cleanupExpiredNotifications(prisma).catch(error => console.error("[notifications] cleanup failed", error instanceof Error ? error.message : "Unknown error")); }, 60 * 60_000);
  const notificationReminderTimer = setInterval(() => { void runNotificationReminders(prisma).catch(error => console.error("[notifications] reminder scheduler failed", error instanceof Error ? error.message : "Unknown error")); }, 5 * 60_000);
  const subscriptionExpiryTimer = setInterval(() => { void expireDueSubscriptions().catch(error => console.error("[subscriptions] expiry worker failed", error instanceof Error ? error.message : "Unknown error")); }, 60_000);
  const subscriptionRenewalTimer = setInterval(() => { void runAutomaticSubscriptionRenewals().catch(error => console.error("[subscriptions] renewal worker failed", error instanceof Error ? error.message : "Unknown error")); }, 5 * 60_000);
  reportTimer.unref();
  notificationTimer.unref();
  notificationCleanupTimer.unref();
  notificationReminderTimer.unref();
  subscriptionExpiryTimer.unref();
  subscriptionRenewalTimer.unref();
  const shutdown = async () => {
    clearInterval(reportTimer);
    clearInterval(notificationTimer);
    clearInterval(notificationCleanupTimer);
    clearInterval(notificationReminderTimer);
    clearInterval(subscriptionExpiryTimer);
    clearInterval(subscriptionRenewalTimer);
    server.close();
    await prisma.$disconnect();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
export const closeDatabase = async () => {
  await prisma.$disconnect();
  await pool.end();
};
export { app, registrationSchema, prisma };
