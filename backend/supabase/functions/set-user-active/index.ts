// Edge Function: set-user-active
// Admin-only "remove"/"restore" staff account. We never HARD delete a user —
// transactions.cashier_id points at users.id with no cascade rule, so deleting
// a user who ever made a sale would break that sale's history. Instead we flip
// is_active to false (deactivated logins can't sign in but their name still
// shows correctly on old receipts/reports).
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json(500, { success: false, error: "Server is missing required configuration (check function secrets)" });
    }

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

    const { data: callerProfile } = await callerClient
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin") {
      return json(403, { success: false, error: "Only admins can change user status" });
    }

    const body = await req.json().catch(() => ({}));
    const targetUserId = typeof body.user_id === "string" ? body.user_id : "";
    const isActive = body.is_active === true;

    if (!targetUserId) {
      return json(400, { success: false, error: "Missing required field: user_id" });
    }
    if (targetUserId === user.id) {
      return json(400, { success: false, error: "You cannot change your own account status" });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: updated, error: updateErr } = await adminClient
      .from("users")
      .update({ is_active: isActive })
      .eq("id", targetUserId)
      .select()
      .single();

    if (updateErr) {
      console.error("status update failed:", JSON.stringify(updateErr));
      return json(500, { success: false, error: `Unexpected error updating user: ${updateErr.message}` });
    }

    return json(200, { success: true, user: updated });
  } catch (e) {
    console.error(e);
    return json(500, { success: false, error: "Unexpected error updating user" });
  }
});
