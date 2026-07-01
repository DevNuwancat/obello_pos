// Edge Function: create-user
// Only an already-logged-in ADMIN can call this to create a new staff account
// (auth login + profile row). The service_role key used here can do ANYTHING
// in the database, so it must only ever live here on the server — never in the
// frontend app.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ALLOWED_ROLES = ["admin", "manager", "cashier"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error("Missing env vars:", {
        supabaseUrl: !!supabaseUrl,
        anonKey: !!anonKey,
        serviceRoleKey: !!serviceRoleKey,
      });
      return json(500, { success: false, error: "Server is missing required configuration (check function secrets)" });
    }

    // 1. Who is calling? Use the caller's own JWT so RLS applies normally.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json(401, { success: false, error: "Missing or invalid authorization token" });
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return json(401, { success: false, error: "Missing or invalid authorization token" });
    }

    // 2. Only admins may create users.
    const { data: callerProfile } = await callerClient
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin") {
      return json(403, { success: false, error: "Only admins can create users" });
    }

    // 3. Validate input.
    const body = await req.json().catch(() => ({}));
    const full_name = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role;

    if (!full_name) {
      return json(400, { success: false, error: "Missing required field: full_name" });
    }
    if (!email || !EMAIL_RE.test(email)) {
      return json(400, { success: false, error: "Invalid email format" });
    }
    if (!password || password.length < 6) {
      return json(400, { success: false, error: "Password must be at least 6 characters" });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return json(400, { success: false, error: "Invalid role. Must be admin, manager, or cashier" });
    }

    // 4. Service-role client — bypasses RLS, can create auth users.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // admin-created staff accounts skip email verification
    });

    if (createErr) {
      console.error("auth.admin.createUser failed:", JSON.stringify(createErr));
      const msg = createErr.message?.toLowerCase() ?? "";
      if (msg.includes("already") || (createErr as { status?: number }).status === 422) {
        return json(409, { success: false, error: "A user with this email already exists" });
      }
      return json(500, { success: false, error: `Unexpected error creating user: ${createErr.message}` });
    }

    // 5. Create (or update, if a trigger already made one) the matching profile row.
    const { data: profile, error: profileErr } = await adminClient
      .from("users")
      .upsert({ id: created.user.id, email, full_name, role, is_active: true })
      .select()
      .single();

    if (profileErr) {
      console.error("profile insert failed:", JSON.stringify(profileErr));
      // Roll back the auth user so we don't leave an orphaned login with no profile.
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json(500, { success: false, error: `Unexpected error creating user: ${profileErr.message}` });
    }

    return json(200, { success: true, user: profile });
  } catch (e) {
    console.error(e);
    return json(500, { success: false, error: "Unexpected error creating user" });
  }
});
