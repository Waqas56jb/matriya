/**
 * Authentication endpoints for MATRIYA RAG System
 */
import express from 'express';
import { User } from './database.js';
import {
  authenticateUser,
  createUser,
  verifyToken,
  getUserByUsername,
  getUserByEmail,
  createAccessToken,
  ACCESS_TOKEN_EXPIRE_MINUTES_EXPORT as ACCESS_TOKEN_EXPIRE_MINUTES,
  createPasswordResetToken,
  verifyPasswordResetToken,
  setUserPassword
} from './auth.js';
import { getDb, initDb } from './database.js';
import logger from './logger.js';

const router = express.Router();

// Middleware to ensure database is initialized (for Vercel serverless)
let dbInitialized = false;
async function ensureDbInitialized(req, res, next) {
  if (!dbInitialized) {
    try {
      await initDb();
      dbInitialized = true;
      logger.info("Database initialized on first request");
    } catch (e) {
      logger.error(`Database initialization failed: ${e.message}`);
      return res.status(503).json({ error: "Database unavailable", detail: e.message });
    }
  }
  next();
}

/**
 * Get current authenticated user from token
 */
async function getCurrentUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }
  
  // Extract token from "Bearer <token>"
  try {
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      return null;
    }
    const token = parts[1];
    
    const payload = verifyToken(token);
    if (!payload) {
      return null;
    }
    
    const username = payload.sub;
    if (!username) {
      return null;
    }
    
    // Get user from database
    return await getUserByUsername(username);
  } catch (e) {
    return null;
  }
}

/**
 * Middleware to require authentication
 */
async function requireAuth(req, res, next) {
  const user = await getCurrentUser(req);
  if (!user) {
    return res.status(401).json({
      error: "Invalid authentication credentials"
    });
  }
  req.user = user;
  next();
}

/**
 * Create a new user account
 * 
 * JSON body:
 *   username: Username
 *   email: Email address
 *   password: Password
 *   full_name: Optional full name
 * 
 * Returns:
 *   Access token and user information
 */
function isPublicSignupDisabled() {
  const v = process.env.MATRIYA_DISABLE_PUBLIC_SIGNUP || process.env.DISABLE_MATRIYA_PUBLIC_SIGNUP;
  return v === '1' || v === 'true' || String(v).toLowerCase() === 'yes';
}

router.post("/signup", ensureDbInitialized, async (req, res) => {
  try {
    if (isPublicSignupDisabled()) {
      return res.status(403).json({ error: 'Self-registration is disabled. Use an administrator-provisioned account.' });
    }
    const { username, email, password, full_name } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: "username, email, and password are required" });
    }
    
    // Basic email validation
    if (!email.includes('@')) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    
    // Check if username already exists
    if (await getUserByUsername(username)) {
      return res.status(400).json({ error: "Username already registered" });
    }
    
    // Check if email already exists
    if (await getUserByEmail(email)) {
      return res.status(400).json({ error: "Email already registered" });
    }
    
    // Create user
    const user = await createUser(username, email, password, full_name);
    
    // Create access token
    const accessToken = createAccessToken(
      { sub: user.username },
      ACCESS_TOKEN_EXPIRE_MINUTES
    );
    
    return res.json({
      access_token: accessToken,
      token_type: "bearer",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        is_admin: user.is_admin
      }
    });
  } catch (e) {
    logger.error(`Signup error: ${e.message}`);
    return res.status(500).json({ error: `Signup failed: ${e.message}` });
  }
});

/**
 * Login and get access token
 * 
 * JSON body:
 *   username: Username
 *   password: Password
 * 
 * Returns:
 *   Access token and user information
 */
router.post("/login", ensureDbInitialized, async (req, res) => {
  try {
    const identifier = (req.body.email || req.body.username || '').trim();
    const { password } = req.body;
    
    if (!identifier || !password) {
      return res.status(400).json({ error: "email (or username) and password are required" });
    }
    
    const user = await authenticateUser(identifier, password);
    if (!user) {
      return res.status(401).json({ error: "Incorrect email or password" });
    }
    
    // Update last login
    try {
      user.last_login = new Date();
      await user.save();
    } catch (e) {
      // Don't fail login if last_login update fails
      logger.warn(`Failed to update last_login: ${e.message}`);
    }
    
    // Create access token
    const accessToken = createAccessToken(
      { sub: user.username },
      ACCESS_TOKEN_EXPIRE_MINUTES
    );
    
    return res.json({
      access_token: accessToken,
      token_type: "bearer",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        is_admin: user.is_admin
      }
    });
  } catch (e) {
    logger.error(`Login error: ${e.message}`);
    return res.status(500).json({ error: `Login failed: ${e.message}` });
  }
});

/**
 * Get current user information
 * 
 * Returns:
 *   Current user information
 */
router.get("/me", ensureDbInitialized, requireAuth, async (req, res) => {
  const user = req.user;
  return res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    full_name: user.full_name,
    is_admin: user.is_admin,
    created_at: user.created_at ? user.created_at.toISOString() : null
  });
});

/**
 * List all users (id, username) for manager "add member" dropdown.
 * Same users as Matriya auth; requires any authenticated user.
 */
const PROVISION_HEADER = 'x-matriya-provision-key';

/** Admin-backend only: create Management panel user (same users table; bcrypt + admin-visible plain copy). */
router.post("/management/provision", ensureDbInitialized, async (req, res) => {
  try {
    const secret = process.env.MATRIYA_PROVISION_SECRET || '';
    const sent = req.get(PROVISION_HEADER) || req.headers[PROVISION_HEADER];
    if (!secret || sent !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { username, email, password, full_name } = req.body || {};
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email, and password are required' });
    }
    if (!String(email).includes('@')) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (await getUserByUsername(String(username).trim())) {
      return res.status(400).json({ error: 'Username already registered' });
    }
    if (await getUserByEmail(String(email).trim())) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    const user = await createUser(String(username).trim(), String(email).trim(), String(password), full_name || null, {
      isManagementUser: true,
      storePlainPasswordForAdmin: true
    });
    return res.status(201).json({
      id: user.id,
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      is_management_user: true,
      password_updated_at: user.password_updated_at ? user.password_updated_at.toISOString() : null
    });
  } catch (e) {
    logger.error(`Management provision error: ${e.message}`);
    return res.status(500).json({ error: e.message || 'Provision failed' });
  }
});

/** Step 1: request reset token (management users only). */
router.post("/management/forgot-request", ensureDbInitialized, async (req, res) => {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    const user = await getUserByEmail(email);
    if (!user || !user.is_management_user) {
      return res.status(404).json({ error: 'No management account found for this email' });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is inactive' });
    }
    const reset_token = createPasswordResetToken(email);
    return res.json({ reset_token, email: user.email });
  } catch (e) {
    logger.error(`Forgot request error: ${e.message}`);
    return res.status(500).json({ error: e.message || 'Request failed' });
  }
});

/** Step 2: set new password using reset_token from forgot-request. */
router.post("/management/forgot-complete", ensureDbInitialized, async (req, res) => {
  try {
    const { reset_token, new_password, confirm_password } = req.body || {};
    const email = verifyPasswordResetToken(String(reset_token || ''));
    if (!email) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Start over from Forgot password.' });
    }
    if (!new_password || new_password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    if (String(new_password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const user = await getUserByEmail(email);
    if (!user || !user.is_management_user) {
      return res.status(404).json({ error: 'Account not found' });
    }
    await setUserPassword(user, new_password, { isManagementReset: true });
    return res.json({ ok: true, message: 'Password updated. You can sign in now.' });
  } catch (e) {
    logger.error(`Forgot complete error: ${e.message}`);
    return res.status(500).json({ error: e.message || 'Reset failed' });
  }
});

router.get("/users", ensureDbInitialized, requireAuth, async (req, res) => {
  try {
    if (!User) return res.status(503).json({ error: "Database not available" });
    const rows = await User.findAll({
      attributes: ["id", "username"],
      order: [["username", "ASC"]],
      where: { is_active: true }
    });
    const users = (rows || []).map(u => ({ user_id: u.id, username: u.username }));
    return res.json({ users });
  } catch (e) {
    logger.error(`List users error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

export { router as authRouter, getCurrentUser, requireAuth };
