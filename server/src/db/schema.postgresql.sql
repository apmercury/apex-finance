-- ============================================================================
-- ApexFinance SaaS: Production PostgreSQL Database Schema
-- Multi-Tenant, Multi-Currency, Strict Financial Precision Architecture
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Companies / Organizations (Multi-Tenant Root)
CREATE TABLE companies (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    business_registration_number VARCHAR(100),
    tax_identification_number VARCHAR(100),
    address TEXT,
    country VARCHAR(100) DEFAULT 'Ghana',
    state VARCHAR(100),
    city VARCHAR(100),
    phone VARCHAR(50),
    email VARCHAR(255),
    website VARCHAR(255),
    default_currency VARCHAR(10) NOT NULL DEFAULT 'GHS',
    fiscal_year_start VARCHAR(10) DEFAULT '01-01',
    invoice_prefix VARCHAR(20) DEFAULT 'INV-',
    invoice_number_format VARCHAR(50) DEFAULT 'INV-{YYYY}-{SEQ:4}',
    default_payment_terms INTEGER DEFAULT 30, -- Days
    bank_details JSONB DEFAULT '{}',
    payment_instructions TEXT,
    logo_url TEXT,
    primary_color VARCHAR(20) DEFAULT '#0284c7',
    secondary_color VARCHAR(20) DEFAULT '#0f172a',
    invoice_theme VARCHAR(50) DEFAULT 'modern',
    email_branding JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    salt VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    is_superadmin BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Roles
CREATE TABLE roles (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Permissions
CREATE TABLE permissions (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    resource VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    description TEXT
);

-- 5. Role Permissions Junction
CREATE TABLE role_permissions (
    role_id VARCHAR(36) NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id VARCHAR(36) NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 6. Company Users (Multi-Tenant Membership & Role Binding)
CREATE TABLE company_users (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id VARCHAR(36) NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, user_id)
);

-- 7. Currencies
CREATE TABLE currencies (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    code VARCHAR(10) NOT NULL,
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    decimal_precision INTEGER DEFAULT 2 CHECK (decimal_precision >= 0 AND decimal_precision <= 4),
    is_active BOOLEAN DEFAULT TRUE,
    is_base BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, code)
);

-- 8. Exchange Rates (Historical rate preservation)
CREATE TABLE exchange_rates (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    from_currency VARCHAR(10) NOT NULL,
    to_currency VARCHAR(10) NOT NULL,
    rate NUMERIC(18, 6) NOT NULL CHECK (rate > 0),
    effective_date DATE NOT NULL,
    source VARCHAR(100) DEFAULT 'manual',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_exchange_rates_lookup ON exchange_rates (company_id, from_currency, to_currency, effective_date DESC);

-- 9. Tax Rates
CREATE TABLE tax_rates (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) NOT NULL,
    percentage NUMERIC(8, 4) NOT NULL CHECK (percentage >= 0),
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. Clients
CREATE TABLE clients (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    company_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    country VARCHAR(100),
    tax_id VARCHAR(100),
    preferred_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    payment_terms INTEGER DEFAULT 30,
    notes TEXT,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
    total_invoiced NUMERIC(18, 4) DEFAULT 0,
    total_paid NUMERIC(18, 4) DEFAULT 0,
    outstanding_balance NUMERIC(18, 4) DEFAULT 0,
    overdue_balance NUMERIC(18, 4) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_clients_company ON clients (company_id);

-- 11. Invoice Templates
CREATE TABLE invoice_templates (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    primary_color VARCHAR(20) DEFAULT '#0284c7',
    secondary_color VARCHAR(20) DEFAULT '#0f172a',
    font_family VARCHAR(100) DEFAULT 'Inter',
    layout_style VARCHAR(50) DEFAULT 'modern' CHECK (layout_style IN ('modern', 'classic', 'minimalist', 'corporate')),
    show_logo BOOLEAN DEFAULT TRUE,
    show_tax_breakdown BOOLEAN DEFAULT TRUE,
    payment_instructions TEXT,
    custom_notes TEXT,
    custom_css TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 12. Invoices
CREATE TABLE invoices (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    invoice_number VARCHAR(100) NOT NULL,
    client_id VARCHAR(36) NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    template_id VARCHAR(36) REFERENCES invoice_templates(id) ON DELETE SET NULL,
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    currency VARCHAR(10) NOT NULL,
    exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1.0, -- Rate to company base currency at time of issue
    base_currency VARCHAR(10) NOT NULL,
    subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0,
    discount_type VARCHAR(20) DEFAULT 'none' CHECK (discount_type IN ('none', 'percent', 'fixed')),
    discount_value NUMERIC(18, 4) DEFAULT 0,
    discount_amount NUMERIC(18, 4) DEFAULT 0,
    tax_amount NUMERIC(18, 4) DEFAULT 0,
    total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
    base_currency_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
    amount_paid NUMERIC(18, 4) NOT NULL DEFAULT 0,
    balance_due NUMERIC(18, 4) NOT NULL DEFAULT 0,
    status VARCHAR(30) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Sent', 'Unpaid', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled')),
    notes TEXT,
    terms TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, invoice_number)
);
CREATE INDEX idx_invoices_company_status ON invoices (company_id, status);
CREATE INDEX idx_invoices_client ON invoices (client_id);

-- 13. Invoice Items
CREATE TABLE invoice_items (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    invoice_id VARCHAR(36) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(18, 4) NOT NULL CHECK (unit_price >= 0),
    discount_percent NUMERIC(8, 4) DEFAULT 0,
    tax_rate_id VARCHAR(36) REFERENCES tax_rates(id) ON DELETE SET NULL,
    tax_rate_percentage NUMERIC(8, 4) DEFAULT 0,
    tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
    line_total NUMERIC(18, 4) NOT NULL,
    line_order INTEGER DEFAULT 0
);
CREATE INDEX idx_invoice_items_invoice ON invoice_items (invoice_id);

-- 14. Payments
CREATE TABLE payments (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    payment_number VARCHAR(100) NOT NULL,
    client_id VARCHAR(36) NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    invoice_id VARCHAR(36) REFERENCES invoices(id) ON DELETE SET NULL,
    amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    currency VARCHAR(10) NOT NULL,
    exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1.0,
    base_currency_amount NUMERIC(18, 4) NOT NULL,
    payment_date DATE NOT NULL,
    payment_method VARCHAR(50) NOT NULL CHECK (payment_method IN ('Bank Transfer', 'Cash', 'Card', 'Mobile Money', 'Cheque', 'Other')),
    reference_number VARCHAR(100),
    notes TEXT,
    status VARCHAR(30) DEFAULT 'Completed' CHECK (status IN ('Completed', 'Reversed', 'Pending')),
    reversal_reason TEXT,
    reversed_at TIMESTAMP WITH TIME ZONE,
    recorded_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, payment_number)
);
CREATE INDEX idx_payments_invoice ON payments (invoice_id);
CREATE INDEX idx_payments_client ON payments (client_id);

-- 15. Payment Allocations (Supports splitting one payment over multiple invoices)
CREATE TABLE payment_allocations (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    payment_id VARCHAR(36) NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id VARCHAR(36) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount_allocated NUMERIC(18, 4) NOT NULL CHECK (amount_allocated > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 16. Expense Categories
CREATE TABLE expense_categories (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, name)
);

-- 17. Expenses
CREATE TABLE expenses (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category_id VARCHAR(36) REFERENCES expense_categories(id) ON DELETE SET NULL,
    vendor VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    currency VARCHAR(10) NOT NULL,
    exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1.0,
    base_currency_amount NUMERIC(18, 4) NOT NULL,
    tax_amount NUMERIC(18, 4) DEFAULT 0,
    expense_date DATE NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'Bank Transfer',
    reference_number VARCHAR(100),
    notes TEXT,
    receipt_url TEXT,
    created_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_expenses_company_date ON expenses (company_id, expense_date);

-- 18. Revenues
CREATE TABLE revenues (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL DEFAULT 'Invoice Payment' CHECK (source_type IN ('Invoice Payment', 'Direct Sale', 'Consulting', 'Service', 'Other')),
    client_id VARCHAR(36) REFERENCES clients(id) ON DELETE SET NULL,
    invoice_id VARCHAR(36) REFERENCES invoices(id) ON DELETE SET NULL,
    payment_id VARCHAR(36) REFERENCES payments(id) ON DELETE SET NULL,
    amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    currency VARCHAR(10) NOT NULL,
    exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1.0,
    base_currency_amount NUMERIC(18, 4) NOT NULL,
    revenue_date DATE NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'Bank Transfer',
    reference_number VARCHAR(100),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 19. General Financial Transactions (Unified Ledger for Audit & Reconciliation)
CREATE TABLE transactions (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('INVOICE_ISSUED', 'PAYMENT_RECEIVED', 'PAYMENT_REVERSED', 'EXPENSE_RECORDED', 'REVENUE_RECORDED', 'CREDIT_ADJUSTMENT')),
    reference_type VARCHAR(50) NOT NULL,
    reference_id VARCHAR(36) NOT NULL,
    client_id VARCHAR(36) REFERENCES clients(id) ON DELETE SET NULL,
    amount NUMERIC(18, 4) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1.0,
    base_currency_amount NUMERIC(18, 4) NOT NULL,
    transaction_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 20. Notifications
CREATE TABLE notifications (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    link VARCHAR(255),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notifications_user ON notifications (company_id, user_id, is_read);

-- 21. Audit Logs (Immutable financial audit trail)
CREATE TABLE audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    user_name VARCHAR(255),
    user_role VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    previous_value JSONB,
    new_value JSONB,
    ip_address VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_logs_company ON audit_logs (company_id, created_at DESC);

-- 22. Company Settings
CREATE TABLE company_settings (
    id VARCHAR(36) PRIMARY KEY,
    company_id VARCHAR(36) NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    setting_key VARCHAR(100) NOT NULL,
    setting_value JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, setting_key)
);
