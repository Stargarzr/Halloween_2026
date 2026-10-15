export function isLocalPreview() {
  return process.env.NODE_ENV === 'development' && !process.env.NETLIFY && !process.env.SUPABASE_URL;
}
export function authConfigured() { return !!(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY); }
export const loopbackHosts=new Set(['localhost','127.0.0.1','[::1]']);
// Exact Host-header match: an allowed hostname plus an optional numeric port, nothing else. No URL parsing: `new URL`
// would accept userinfo (evil.example@localhost), paths (localhost/x), and abbreviated IPv4 (127.1).
export function isLoopbackHost(host:unknown):boolean{
  if(typeof host!=='string')return false;
  const match=/^(\[[0-9a-f:]+\]|[^\s:\/?#@\[\]]+)(?::(\d{1,5}))?$/i.exec(host);
  if(!match||(match[2]!==undefined&&Number(match[2])>65535))return false;
  return loopbackHosts.has(match[1].toLowerCase());
}
