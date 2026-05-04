/**
 * RAG user-facing strings only — keep separate from ragService.js so server cold start
 * does not load pdf-parse / documentProcessor (breaks Vercel serverless).
 */
export const RAG_INSUFFICIENT_SUPPORT_MESSAGE_HE = 'אין במערכת מידע תומך לשאלה זו.';
