/**
 * Authentication utilities
 */
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { User, sequelize } from './database.js';

// JWT settings
const SECRET_KEY = process.env.JWT_SECRET || crypto.randomBytes(32).toString('base64');
const ALGORITHM = "HS256";
const ACCESS_TOKEN_EXPIRE_MINUTES = 30 * 24 * 60; // 30 days

export const ACCESS_TOKEN_EXPIRE_MINUTES_EXPORT = ACCESS_TOKEN_EXPIRE_MINUTES;

/**
 * Verify a password against its hash
 */
export function verifyPassword(plainPassword, hashedPassword) {
  return bcrypt.compareSync(plainPassword, hashedPassword);
}

/**
 * Hash a password
 */
export function getPasswordHash(password) {
  return bcrypt.hashSync(password, 10);
}

/**
 * Create a JWT access token
 */
export function createAccessToken(data, expiresDelta = null) {
  const toEncode = { ...data };
  const expire = expiresDelta 
    ? new Date(Date.now() + expiresDelta * 60 * 1000)
    : new Date(Date.now() + ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000);
  
  toEncode.exp = Math.floor(expire.getTime() / 1000);
  return jwt.sign(toEncode, SECRET_KEY, { algorithm: ALGORITHM });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET_KEY, { algorithms: [ALGORITHM] });
  } catch (e) {
    return null;
  }
}

/**
 * Get user by username
 */
export async function getUserByUsername(username) {
  if (!User) {
    throw new Error("Database not initialized. User model is not available.");
  }
  return await User.findOne({ where: { username } });
}

/**
 * Get user by email
 */
export async function getUserByEmail(email) {
  if (!User) {
    throw new Error("Database not initialized. User model is not available.");
  }
  const norm = String(email || '').trim().toLowerCase();
  if (!norm) return null;
  return await User.findOne({
    where: sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), norm)
  });
}

/**
 * Authenticate a user
 */
export async function authenticateUser(usernameOrEmail, password) {
  const id = String(usernameOrEmail || '').trim();
  if (!id || !password) return null;
  let user = null;
  if (id.includes('@')) {
    user = await getUserByEmail(id);
  } else {
    user = await getUserByUsername(id);
  }
  if (!user) {
    return null;
  }
  if (!verifyPassword(password, user.hashed_password)) {
    return null;
  }
  if (!user.is_active) {
    return null;
  }
  return user;
}

/**
 * Create a new user
 */
export async function createUser(username, email, password, fullName = null, options = {}) {
  if (!User) {
    throw new Error("Database not initialized. User model is not available.");
  }
  const {
    isManagementUser = false,
    /** When true, stores plaintext copy in management_plain_password for admin UI (login still uses bcrypt). */
    storePlainPasswordForAdmin = false
  } = options;
  const hashedPassword = getPasswordHash(password);
  const emailNorm = String(email || '').trim().toLowerCase();
  const user = await User.create({
    username: String(username || '').trim(),
    email: emailNorm,
    hashed_password: hashedPassword,
    full_name: fullName,
    is_active: true,
    is_admin: false,
    is_management_user: isManagementUser,
    management_plain_password: storePlainPasswordForAdmin ? String(password) : null,
    password_updated_at: storePlainPasswordForAdmin ? new Date() : null
  });
  return user;
}

/** Update password (bcrypt + optional admin-visible copy for management users). */
export async function setUserPassword(user, newPassword, { isManagementReset = false } = {}) {
  user.hashed_password = getPasswordHash(newPassword);
  if (isManagementReset || user.is_management_user) {
    user.management_plain_password = String(newPassword);
    user.password_updated_at = new Date();
  }
  await user.save();
  return user;
}

const RESET_TOKEN_EXPIRE_SEC = 30 * 60;

export function createPasswordResetToken(email) {
  return jwt.sign(
    { typ: 'pwd_reset', email: String(email).trim().toLowerCase() },
    SECRET_KEY,
    { algorithm: ALGORITHM, expiresIn: RESET_TOKEN_EXPIRE_SEC }
  );
}

export function verifyPasswordResetToken(token) {
  try {
    const p = jwt.verify(token, SECRET_KEY, { algorithms: [ALGORITHM] });
    if (p.typ !== 'pwd_reset' || !p.email) return null;
    return String(p.email).trim().toLowerCase();
  } catch {
    return null;
  }
}
