/* Supabase 客戶端 v1.0
 * 取代自寫的 JWT auth 系統
 * 使用 Supabase Auth（內建登入/註冊/session 管理）
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://bcdanvmuffxgtezopyib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjZGFudm11ZmZ4Z3Rlem9weWliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3OTEzNTMsImV4cCI6MjEwNzM2NzM1M30.EZtkULSRB_qwVyDl86MOhGf_ihKAAMy7q3fwuKYX0JI';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* 登入狀態 */
export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function isLoggedIn() {
  const user = await getUser();
  return !!user;
}

/* 登入 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  // 確保 profiles 有資料
  await ensureProfile(data.user);
  return data.user;
}

/* 註冊 */
export async function signUp(email, password, name) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (data.user) {
    await supabase.from('profiles').upsert({
      id: data.user.id,
      name: name || email.split('@')[0],
      email: email
    });
  }
  return data.user;
}

/* 登出 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/* 確保 profiles 表有該用戶資料 */
async function ensureProfile(user) {
  if (!user) return;
  const { data } = await supabase.from('profiles').select('id').eq('id', user.id).single();
  if (!data) {
    await supabase.from('profiles').insert({
      id: user.id,
      name: user.email?.split('@')[0] || '旅人',
      email: user.email
    });
  }
}

/* 監聽登入狀態變化 */
export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session?.user || null);
  });
}

/* 取得用戶 profile（含星砂餘額） */
export async function getProfile() {
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return data;
}
