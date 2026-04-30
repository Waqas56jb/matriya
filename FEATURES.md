# MATRIYA Admin Panel — Feature List

## User Access Control
- Approve / reject new user access requests
- Block user permanently (username + device)
- Revoke active session immediately
- Whitelist / blacklist phone numbers via UI
- Set per-user role: Admin, Operator, Viewer, Blocked
- Generate username + password for management frontend
- Reset user password from admin panel
- Force logout any active user instantly

## User & Session Visibility
- See all currently logged-in users live
- View active WhatsApp sessions in real time
- See which users are using MATRIYA services now
- Device fingerprint log per user login
- Login history: time, IP, device per user
- Failed login attempts with auto-lock threshold
- Session duration and last activity per user

## Analytics & Traffic
- Daily / weekly visitors graph on matriya-front
- Total WhatsApp messages received per day
- Decision breakdown: GO / ITERATE / STOP counts
- Pipeline response time trends (avg, p95)
- Most active users ranked by message count
- New user requests pending approval count
- Rachel outbound notification delivery stats

## WhatsApp Management
- View full WhatsApp task queue in real time
- See candidates sent per ITERATE decision
- Resend failed outbound messages manually
- Add / remove numbers from whitelist in UI
- View blocked numbers with reason and timestamp
- Replay any past pipeline decision on demand

## Experiments & Data
- Browse experiments table with filters and search
- Manually set decision_shift / breakdown_flag / validated
- Export experiments to CSV with one click
- View RAG document library (uploaded files list)
- Delete or replace uploaded RAG documents
- Trigger pipeline manually with custom input

## System & Infrastructure
- Railway deployment status per service
- Supabase connection health check
- OpenAI API usage and token spend tracker
- View and search backend error logs live
- Restart any Railway service from admin panel
- Environment variable viewer (masked secrets)

## Security & Audit
- Full audit log: who did what and when
- IP-based access restriction for admin panel
- Admin actions are logged and cannot be deleted
- Two-factor authentication (2FA) for admin login
- Suspicious activity alerts via WhatsApp to admin
- Device block: prevent specific device from re-login

## Content & Configuration
- Edit MATRIYA system prompt from UI (no redeploy)
- Configure confidence thresholds from admin panel
- Set STOP / ITERATE / GO threshold values live
- Manage approved experiment domains list
- Configure cron schedule for matriya-finance
- Set daily pipeline run limits per user
