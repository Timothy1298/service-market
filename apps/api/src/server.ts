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
import {
  InvoiceStatus,
  PrismaClient,
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
const phoneSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.replace(/[\s-]/g, "") : value),
  z
    .string()
    .trim()
    .regex(/^(?:\+?254|0)7\d{8}$/, "Use a valid Kenyan mobile number"),
);
const registrationSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100),
    phone: phoneSchema,
    email: z.string().trim().email().optional().or(z.literal("")),
    password: z
      .string()
      .min(8)
      .max(128)
      .regex(/[A-Za-z]/)
      .regex(/\d/),
    confirmPassword: z.string(),
    accountType: z.enum(["PROVIDER", "CUSTOMER"]),
    businessName: z.string().trim().min(2).max(120).optional(),
    tradeCategory: z.string().trim().min(2).max(80).optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })
  .refine(
    (data) =>
      data.accountType !== "PROVIDER" ||
      Boolean(data.businessName && data.tradeCategory),
    {
      path: ["businessName"],
      message: "Business name and trade are required for providers",
    },
  );
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
      if (existing)
        return res
          .status(409)
          .json({
            error:
              existing.phone === phone
                ? "That phone number is already registered"
                : "That email address is already registered",
          });
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
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: input.identifier.toLowerCase() },
            { phone: input.identifier },
          ],
        },
      });
      if (user) {
        await prisma.passwordResetToken.deleteMany({
          where: { userId: user.id },
        });
        const token = crypto.randomBytes(32).toString("hex");
        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: tokenHash(token),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        });
      }
      res.json({
        message:
          "If an account matches those details, recovery instructions have been prepared.",
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
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(30).default(12),
      })
      .parse(req.query);
    const where = {
      providerProfiles: { some: {} },
      ...(query.search
        ? {
            OR: [
              {
                name: { contains: query.search, mode: "insensitive" as const },
              },
              {
                slogan: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
      ...(query.category
        ? {
            providerProfiles: {
              some: {
                tradeCategory: {
                  equals: query.category,
                  mode: "insensitive" as const,
                },
              },
            },
          }
        : {}),
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
      },
    });
    if (!business) return res.status(404).json({ error: "Provider not found" });
    res.json({ provider: business });
  } catch (error) {
    next(error);
  }
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
      const request = await prisma.serviceRequest.create({
        data: { ...input, customerId: req.user!.id },
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
    const request = await prisma.serviceRequest.findFirst({
      where:
        req.user!.role === "CUSTOMER"
          ? { id, customerId: req.user!.id }
          : { id, status: { in: ["OPEN", "IN_PROGRESS"] } },
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
      const request = await prisma.serviceRequest.update({
        where: { id: current.id },
        data: input,
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
  async (_req, res, next) => {
    try {
      const requests = await prisma.serviceRequest.findMany({
        where: { status: "OPEN" },
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
      const customer = await prisma.customerRecord.create({
        data: {
          ...input,
          email: input.email || null,
          businessId: membership.businessId,
        },
      });
      res.status(201).json({ customer });
    } catch (error) {
      next(error);
    }
  },
);
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
const moneyCents = (value: number) => Math.round(value * 100);
const centsMoney = (value: number) => (value / 100).toFixed(2);
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
    tax: z.coerce.number().nonnegative().default(0),
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
      const totals = calculateQuotation(input.items, input.discount, input.tax);
      const year = new Date().getFullYear();
      const count = await prisma.quotation.count({
        where: { businessId: membership.businessId },
      });
      const quotation = await prisma.quotation.create({
        data: {
          businessId: membership.businessId,
          customerId: customer.id,
          serviceRequestId: input.serviceRequestId,
          quotationNumber: `QT-${year}-${String(count + 1).padStart(5, "0")}`,
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
      const totals = calculateQuotation(input.items, input.discount, input.tax);
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
      const issued = await prisma.quotation.update({
        where: { id: current.id },
        data: {
          status: "ISSUED",
          issueDate: new Date(),
          issuedSnapshot: {
            business: {
              name: current.business.name,
              phone: current.business.phone,
              email: current.business.email,
              address: current.business.address,
              slogan: current.business.slogan,
            },
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
  tax: z.coerce.number().nonnegative().default(0),
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
const invoiceNumberFor = async (businessId: string) => {
  const year = new Date().getFullYear();
  const count = await prisma.invoice.count({ where: { businessId } });
  return `INV-${year}-${String(count + 1).padStart(5, "0")}`;
};
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
    const totals = calculateInvoice(items, quote ? Number(quote.discount) : input.discount, quote ? Number(quote.tax) : input.tax);
    const invoiceNumber = await invoiceNumberFor(membership.businessId);
    const invoice = await prisma.invoice.create({ data: { businessId: membership.businessId, customerId: customer.id, jobId, quotationId: quote?.id, invoiceNumber, issueDate: input.issueDate, dueDate: input.dueDate, currency: business.currency, subtotal: totals.subtotal, discount: totals.discount, tax: totals.tax, grandTotal: totals.grandTotal, paymentTerms: input.paymentTerms ?? quote?.paymentTerms, notes: input.notes ?? quote?.terms ?? quote?.description, items: { create: totals.lineItems.map((item, index) => ({ ...item, sortOrder: index })) } }, include: invoiceInclude });
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
    const totals = calculateInvoice(input.items, input.discount, input.tax);
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
    const issued = await prisma.invoice.update({ where: { id: current.id }, data: { status: "ISSUED", issueDate: current.issueDate ?? new Date(), issuedSnapshot: { business: { name: business.name, phone: business.phone, email: business.email, address: business.address, paymentInstructions: business.paymentInstructions }, customer: { name: customer.name, phone: customer.phone, email: customer.email, billingAddress: customer.billingAddress }, totals: { subtotal: current.subtotal.toString(), discount: current.discount.toString(), tax: current.tax.toString(), grandTotal: current.grandTotal.toString() } } }, include: invoiceInclude });
    res.json({ invoice: issued });
  } catch (error) { next(error); }
});
app.post("/api/invoices/:id/cancel", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await providerMembership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const current = await prisma.invoice.findFirst({ where: { id: String(req.params.id), businessId: membership.businessId }, include: { payments: true } });
    if (!current) return res.status(404).json({ error: "Invoice not found" });
    if (current.status === "PAID" || current.payments.length) return res.status(409).json({ error: "Invoices with recorded payments cannot be cancelled" });
    if (current.status === "CANCELLED") return res.status(409).json({ error: "Invoice is already cancelled" });
    const invoice = await prisma.invoice.update({ where: { id: current.id }, data: { status: "CANCELLED" }, include: invoiceInclude });
    res.json({ invoice });
  } catch (error) { next(error); }
});
app.post("/api/invoices/:id/payments", auth, role("PROVIDER"), async (req: AuthedRequest, res, next) => {
  try {
    const membership = await providerMembership(req.user!.id);
    if (!membership) return res.status(403).json({ error: "Business membership required" });
    const input = z.object({ amount: z.coerce.number().positive().max(100000000), method: z.enum(["CASH", "BANK_TRANSFER", "OTHER"]), paymentDate: z.coerce.date().optional(), reference: z.string().trim().max(120).optional(), notes: z.string().trim().max(1000).optional() }).strict().parse(req.body);
    const amountCents = moneyCents(input.amount);
    const result = await prisma.$transaction(async tx => {
      const invoice = await tx.invoice.findFirst({ where: { id: String(req.params.id), businessId: membership.businessId } });
      if (!invoice) throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
      if (["DRAFT", "CANCELLED"].includes(invoice.status)) throw Object.assign(new Error("Payments can only be recorded against issued invoices"), { statusCode: 409 });
      const existingPaid = await tx.payment.aggregate({ where: { invoiceId: invoice.id }, _sum: { amount: true } });
      const paidCents = moneyCents(Number(existingPaid._sum.amount ?? 0));
      const totalCents = moneyCents(Number(invoice.grandTotal));
      if (amountCents <= 0 || paidCents + amountCents > totalCents) throw Object.assign(new Error("Payment cannot exceed the outstanding balance"), { statusCode: 400 });
      const payment = await tx.payment.create({ data: { businessId: membership.businessId, invoiceId: invoice.id, amount: centsMoney(amountCents), paymentDate: input.paymentDate ?? new Date(), method: input.method, reference: input.reference, notes: input.notes, recordedById: req.user!.id } });
      const newPaid = paidCents + amountCents;
      const status = newPaid >= totalCents ? "PAID" : "PARTIALLY_PAID";
      await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: centsMoney(newPaid), status } });
      return payment;
    }, { isolationLevel: "Serializable" });
    res.status(201).json({ payment: result });
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
    doc.fontSize(20).fillColor("#163d52").text(business.name, { continued: true }).fontSize(11).text("INVOICE", { align: "right" });
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
    for (const [label, amount] of [["Subtotal", invoice.subtotal], ["Discount", invoice.discount], ["Tax", invoice.tax], ["Total", invoice.grandTotal], ["Paid", invoice.amountPaid], ["Balance due", Number(invoice.grandTotal) - Number(invoice.amountPaid)]] as const) doc.text(label, 350, doc.y, { continued: true }).text(fmt(amount), { align: "right" });
    if (business.paymentInstructions || invoice.paymentTerms || invoice.notes) { doc.moveDown().fontSize(9).fillColor("#52616b"); if (business.paymentInstructions) doc.text(`Payment instructions: ${business.paymentInstructions}`); if (invoice.paymentTerms) doc.text(`Payment terms: ${invoice.paymentTerms}`); if (invoice.notes) doc.text(`Notes: ${invoice.notes}`); }
    doc.end();
  } catch (error) { next(error); }
});
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

if (require.main === module) {
  const server = app.listen(port, () =>
    console.log(`FundiQuote API listening on ${port}`),
  );
  const shutdown = async () => {
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
export { app, registrationSchema };
