import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const categories = [
  ['electrical', 'Electrical installation and repairs'],
  ['plumbing', 'Plumbing'],
  ['hvac-refrigeration', 'HVAC and refrigeration'],
  ['masonry-construction', 'Masonry and construction'],
  ['painting', 'Painting'],
  ['carpentry-joinery', 'Carpentry and joinery'],
  ['general-maintenance', 'General maintenance'],
  ['other', 'Other'],
]

async function seed() {
  for (const [slug, name] of categories) await prisma.serviceCategory.upsert({ where: { slug }, update: { name, isActive: true }, create: { slug, name } })
  await prisma.$disconnect()
  await pool.end()
  console.log(`Seeded ${categories.length} service categories.`)
}

seed().catch(async (error) => { console.error(error instanceof Error ? error.message : error); await prisma.$disconnect(); await pool.end(); process.exitCode = 1 })
