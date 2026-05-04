/**
 * Vercel + Supabase often inject `DATABASE_URL` only. This codebase uses `POSTGRES_URL`
 * in Sequelize, RAGService, and health checks — mirror once after dotenv loads.
 */
export function normalizePostgresEnv() {
  const trim = (v) => {
    if (v == null) return '';
    return String(v).replace(/^\uFEFF/, '').trim();
  };
  if (trim(process.env.POSTGRES_URL)) return;
  const fallback =
    trim(process.env.POSTGRES_PRISMA_URL) || trim(process.env.DATABASE_URL);
  if (fallback) {
    process.env.POSTGRES_URL = fallback;
  }
}
