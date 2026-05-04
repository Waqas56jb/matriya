/**
 * Vercel serverless entry — Express app (same pattern as matriya-back).
 * Load dotenv + env mirrors before anything else (server.js also imports this first).
 */
import '../load-env.js';
import './vercel-env.js';
import app from '../server.js';

export default app;
