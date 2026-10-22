export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type PlatformDatabase = {
  public: {
    Tables: {
      platform_state: {
        Row: {
          id: number;
          initialized: boolean;
          setup_token_hash: string | null;
          platform_domain: string | null;
          reserved_subdomains: string[];
        };
        Insert: {
          id?: number;
          initialized?: boolean;
          setup_token_hash?: string | null;
          platform_domain?: string | null;
          reserved_subdomains?: string[];
        };
        Update: {
          initialized?: boolean;
          setup_token_hash?: string | null;
          platform_domain?: string | null;
          reserved_subdomains?: string[];
        };
        Relationships: [];
      };
      platform_super_admins: {
        Row: {
          id: string;
          email: string;
          password_hash: string;
          totp_secret_ciphertext: string;
          recovery_code_hashes: string[];
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          password_hash: string;
          totp_secret_ciphertext: string;
          recovery_code_hashes?: string[];
          created_at: string;
        };
        Update: {
          recovery_code_hashes?: string[];
        };
        Relationships: [];
      };
      platform_audit_log: {
        Row: {
          id: string;
          actor_id: string;
          scope: unknown;
          action: string;
          resource_type: string;
          resource_id: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          actor_id: string;
          scope: unknown;
          action: string;
          resource_type: string;
          resource_id?: string | null;
          created_at: string;
        };
        Update: never;
        Relationships: [];
      };
      platform_secret_vault: {
        Row: {
          ref: string;
          tenant_id: string | null;
          name: string;
          encrypted_value: string;
          created_at: string;
        };
        Insert: {
          ref: string;
          tenant_id?: string | null;
          name: string;
          encrypted_value: string;
          created_at: string;
        };
        Update: {
          tenant_id?: string | null;
          name?: string;
          encrypted_value?: string;
        };
        Relationships: [];
      };
      platform_rate_limits: {
        Row: {
          key_hash: string;
          count: number;
          reset_at: string;
        };
        Insert: {
          key_hash: string;
          count: number;
          reset_at: string;
        };
        Update: {
          count?: number;
          reset_at?: string;
        };
        Relationships: [];
      };
      platform_hosts: {
        Row: {
          id: string;
          slug: string;
          name: string;
          status: "pending" | "active" | "suspended";
          plan: string;
          limits: Json;
          branding: Json;
          support_contact: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          slug: string;
          name: string;
          status: "pending" | "active" | "suspended";
          plan: string;
          limits: Json;
          branding: Json;
          support_contact?: string | null;
          created_at: string;
          updated_at: string;
        };
        Update: {
          status?: "pending" | "active" | "suspended";
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_host_domains: {
        Row: {
          domain: string;
          host_id: string;
          created_at: string;
        };
        Insert: {
          domain: string;
          host_id: string;
          created_at: string;
        };
        Update: never;
        Relationships: [];
      };
      platform_host_owners: {
        Row: {
          id: string;
          host_id: string;
          email: string;
          password_hash: string;
          created_at: string;
        };
        Insert: {
          id: string;
          host_id: string;
          email: string;
          password_hash: string;
          created_at: string;
        };
        Update: never;
        Relationships: [];
      };
      platform_host_owner_invites: {
        Row: {
          id: string;
          host_id: string;
          email: string;
          token_hash: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id: string;
          host_id: string;
          email: string;
          token_hash: string;
          expires_at: string;
          created_at: string;
        };
        Update: never;
        Relationships: [];
      };
      platform_tenants: {
        Row: {
          id: string;
          host_id: string;
          slug: string;
          name: string;
          status: "pending" | "active" | "suspended";
          plan: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          host_id: string;
          slug: string;
          name: string;
          status: "pending" | "active" | "suspended";
          plan: string;
          created_at: string;
          updated_at: string;
        };
        Update: {
          status?: "pending" | "active" | "suspended";
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_tenant_domains: {
        Row: {
          domain: string;
          tenant_id: string;
          host_id: string;
          created_at: string;
        };
        Insert: {
          domain: string;
          tenant_id: string;
          host_id: string;
          created_at: string;
        };
        Update: never;
        Relationships: [];
      };
      platform_tenant_owners: {
        Row: {
          id: string;
          tenant_id: string;
          host_id: string;
          email: string;
          password_hash: string;
          created_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          host_id: string;
          email: string;
          password_hash: string;
          created_at: string;
        };
        Update: never;
        Relationships: [];
      };
      platform_tenant_staff: {
        Row: {
          id: string;
          tenant_id: string;
          host_id: string;
          email: string;
          password_hash: string;
          permissions: string[];
          active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          host_id: string;
          email: string;
          password_hash: string;
          permissions: string[];
          active?: boolean;
          created_at: string;
        };
        Update: {
          password_hash?: string;
          permissions?: string[];
          active?: boolean;
        };
        Relationships: [];
      };
      platform_customers: {
        Row: {
          id: string;
          tenant_id: string;
          email: string;
          password_hash: string;
          created_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          email: string;
          password_hash: string;
          created_at: string;
        };
        Update: never;
        Relationships: [];
      };
      platform_customer_orders: {
        Row: {
          id: string;
          tenant_id: string;
          customer_id: string;
          status: "Confirmed" | "Processing" | "Shipped";
          created_at: string;
          items: Json;
          total: number;
          currency: string;
          item_count: number;
          payment_status: "pending" | "paid" | "failed";
          payment_attempt: number;
          payment_session_id: string | null;
          payment_intent_id: string | null;
          backend_sync_status:
            "not_configured" | "pending" | "synced" | "failed";
          backend_sync_error: string | null;
        };
        Insert: {
          id: string;
          tenant_id: string;
          customer_id: string;
          status: "Confirmed" | "Processing" | "Shipped";
          created_at: string;
          items?: Json;
          total: number;
          currency: string;
          item_count: number;
          payment_status?: "pending" | "paid" | "failed";
          payment_attempt?: number;
          payment_session_id?: string | null;
          payment_intent_id?: string | null;
          backend_sync_status?:
            "not_configured" | "pending" | "synced" | "failed";
          backend_sync_error?: string | null;
        };
        Update: {
          status?: "Confirmed" | "Processing" | "Shipped";
          payment_status?: "pending" | "paid" | "failed";
          payment_attempt?: number;
          payment_session_id?: string | null;
          payment_intent_id?: string | null;
          backend_sync_status?:
            "not_configured" | "pending" | "synced" | "failed";
          backend_sync_error?: string | null;
        };
        Relationships: [];
      };
      platform_tenant_owner_invites: {
        Row: {
          id: string;
          tenant_id: string;
          host_id: string;
          email: string;
          token_hash: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          host_id: string;
          email: string;
          token_hash: string;
          expires_at: string;
          created_at: string;
        };
        Update: never;
        Relationships: [];
      };
      platform_tenant_settings: {
        Row: {
          tenant_id: string;
          host_id: string;
          branding: Json;
          locale: Json;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          host_id: string;
          branding: Json;
          locale: Json;
          updated_at: string;
        };
        Update: {
          branding?: Json;
          locale?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_tenant_rest_connections: {
        Row: {
          tenant_id: string;
          host_id: string;
          base_url: string;
          api_version: string;
          auth_mode: "apiKey";
          api_key_ref: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          host_id: string;
          base_url: string;
          api_version: string;
          auth_mode?: "apiKey";
          api_key_ref: string;
          updated_at: string;
        };
        Update: {
          base_url?: string;
          api_version?: string;
          auth_mode?: "apiKey";
          api_key_ref?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      claim_platform_bootstrap: {
        Args: {
          p_setup_token_hash: string;
          p_platform_domain: string;
          p_reserved_subdomains: string[];
          p_admin_id: string;
          p_admin_email: string;
          p_password_hash: string;
          p_totp_secret_ciphertext: string;
          p_created_at: string;
        };
        Returns: boolean;
      };
      finalize_platform_bootstrap: {
        Args: {
          p_setup_token_hash: string;
          p_admin_id: string;
          p_recovery_code_hashes: string[];
          p_audit_id: string;
          p_audit_actor_id: string;
          p_audit_action: string;
          p_audit_resource_type: string;
          p_audit_created_at: string;
        };
        Returns: boolean;
      };
      consume_platform_rate_limit: {
        Args: {
          p_key_hash: string;
          p_limit: number;
          p_window_ms: number;
          p_now: string;
        };
        Returns: boolean;
      };
      consume_platform_recovery_code: {
        Args: { p_admin_id: string; p_code_hash: string };
        Returns: boolean;
      };
      create_platform_host: {
        Args: {
          p_host_id: string;
          p_slug: string;
          p_name: string;
          p_status: string;
          p_plan: string;
          p_limits: Json;
          p_branding: Json;
          p_domains: string[];
          p_support_contact: string | null;
          p_created_at: string;
          p_actor_id: string;
          p_audit_id: string;
          p_audit_action: string;
          p_audit_resource_type: string;
          p_audit_resource_id: string | null;
          p_audit_created_at: string;
        };
        Returns: boolean;
      };
      update_platform_host_status: {
        Args: {
          p_host_id: string;
          p_status: string;
          p_updated_at: string;
          p_actor_id: string;
          p_audit_id: string;
          p_audit_action: string;
          p_audit_resource_type: string;
          p_audit_resource_id: string | null;
          p_audit_created_at: string;
        };
        Returns: boolean;
      };
      create_platform_host_owner_invite: {
        Args: {
          p_invite_id: string;
          p_host_id: string;
          p_email: string;
          p_token_hash: string;
          p_expires_at: string;
          p_created_at: string;
          p_actor_id: string;
          p_audit_id: string;
          p_audit_action: string;
          p_audit_resource_id: string | null;
          p_audit_created_at: string;
        };
        Returns: boolean;
      };
      accept_platform_host_owner_invite: {
        Args: {
          p_token_hash: string;
          p_owner_id: string;
          p_password_hash: string;
          p_now: string;
          p_audit_id: string;
          p_audit_actor_id: string;
          p_audit_action: string;
          p_audit_created_at: string;
        };
        Returns: Json;
      };
      create_platform_tenant: {
        Args: {
          p_tenant_id: string;
          p_host_id: string;
          p_slug: string;
          p_name: string;
          p_status: string;
          p_plan: string;
          p_domains: string[];
          p_created_at: string;
          p_actor_id: string;
          p_audit_id: string;
          p_audit_action: string;
          p_audit_resource_id: string | null;
          p_audit_created_at: string;
        };
        Returns: string;
      };
      update_platform_tenant_status: {
        Args: {
          p_host_id: string;
          p_tenant_id: string;
          p_status: string;
          p_updated_at: string;
          p_actor_id: string;
          p_audit_id: string;
          p_audit_action: string;
          p_audit_resource_id: string | null;
          p_audit_created_at: string;
        };
        Returns: boolean;
      };
      create_platform_tenant_owner_invite: {
        Args: {
          p_invite_id: string;
          p_tenant_id: string;
          p_host_id: string;
          p_email: string;
          p_token_hash: string;
          p_expires_at: string;
          p_created_at: string;
          p_actor_id: string;
          p_audit_id: string;
          p_audit_action: string;
          p_audit_resource_id: string | null;
          p_audit_created_at: string;
        };
        Returns: boolean;
      };
      accept_platform_tenant_owner_invite: {
        Args: {
          p_token_hash: string;
          p_owner_id: string;
          p_password_hash: string;
          p_now: string;
          p_audit_id: string;
          p_audit_actor_id: string;
          p_audit_action: string;
          p_audit_created_at: string;
        };
        Returns: Json;
      };
      update_platform_tenant_settings: {
        Args: {
          p_tenant_id: string;
          p_host_id: string;
          p_branding: Json;
          p_locale: Json;
          p_updated_at: string;
          p_actor_id: string;
          p_audit_id: string;
          p_audit_action: string;
          p_audit_resource_id: string | null;
          p_audit_created_at: string;
        };
        Returns: boolean;
      };
      update_platform_tenant_rest_connection: {
        Args: {
          p_tenant_id: string;
          p_host_id: string;
          p_base_url: string;
          p_api_version: string;
          p_api_key_ref: string;
          p_updated_at: string;
          p_actor_id: string;
          p_audit_id: string;
          p_audit_action: string;
          p_audit_resource_id: string | null;
          p_audit_created_at: string;
        };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
