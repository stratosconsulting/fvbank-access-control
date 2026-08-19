import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Cópialas de Supabase → Project Settings → API, y ponlas en tu archivo .env (ver .env.example)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
