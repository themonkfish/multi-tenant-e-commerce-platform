import "server-only";
import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "multi-tenant-e-commerce-platform",
});

export type BackgroundEvent =
  | {
      name: "email/invitation.requested";
      data: {
        role: "host_owner" | "tenant_owner";
        to: string;
        inviteUrl: string;
        expiresAt: string;
      };
    }
  | {
      name: "carrier/event.retry";
      data: {
        tenantId: string;
        orderId: string;
        trackingNumber: string;
        status: "Processing" | "Shipped" | "Delivered";
        carrier?: string;
        eventId: string;
      };
    }
  | {
      name: "email/password-reset.requested";
      data: {
        to: string;
        resetUrl: string;
        expiresAt: string;
      };
    };

export async function enqueueBackgroundEvent(event: BackgroundEvent) {
  const envKey = process.env.INNGEST_EVENT_KEY?.trim();
  if (!envKey) {
    return false;
  }
  await inngest.send(event);
  return true;
}
