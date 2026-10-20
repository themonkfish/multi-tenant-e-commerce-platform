export interface SecretVault {
  putSecret(input: {
    tenantId?: string;
    name: string;
    value: string;
  }): Promise<string>;
  getSecret(secretRef: string): Promise<string>;
  deleteSecret(secretRef: string): Promise<void>;
}
