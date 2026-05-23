# Test Fixtures

## send-email-snapshot.txt
Snapshot der deployten send-email Edge Function (Version 46).

Wird zur Test-Laufzeit gelesen von tests/e2e/27-email-plausibilitaet.spec.ts
um conditional-logic der Email-Templates zu prüfen.

**Bei jedem deploy_edge_function neu ziehen:**
mcp__supabase__get_edge_function project_id=jcczvyablgdijeiyymhc function_slug=send-email
→ files[0].content speichern als tests/fixtures/send-email-snapshot.txt
