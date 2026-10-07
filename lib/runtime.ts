export function isLocalPreview() {
  return process.env.NODE_ENV === 'development' && !process.env.NETLIFY && !process.env.SUPABASE_URL;
}
export function authConfigured() { return !!(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY); }
