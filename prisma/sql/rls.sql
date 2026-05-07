-- =====================================================================
-- Row Level Security: enforce tenant isolation at the database layer.
-- The app sets `app.tenant_id` per request via PrismaService transaction
-- middleware. Even if a query forgets to filter by tenantId, RLS clamps
-- it. Service-role connections bypass RLS via BYPASSRLS.
-- =====================================================================

ALTER TABLE certificates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sped_jobs          ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_certificates ON certificates
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_invoices ON invoices
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_webhooks ON webhooks
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_webhook_deliveries ON webhook_deliveries
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_usage ON usage_records
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_api_keys ON api_keys
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation_sped_jobs ON sped_jobs
  USING (tenant_id = current_setting('app.tenant_id', true));
