import { Inngest } from "inngest";
import { sendInvitationEmail } from "./invitation-email";
import { applyCarrierEvent } from "./carrier-event-handler";
import type { CarrierEventStatus } from "./carrier-webhooks";

export const inngest = new Inngest({
  id: "multi-tenant-e-commerce-platform",
});

export const sendInvitationEmailFunction = inngest.createFunction(
  {
    id: "send-invitation-email",
    retries: 5,
    triggers: [{ event: "email/invitation.requested" }],
  },
  async ({ event }) => {
    const data = event.data as {
      role: "host_owner" | "tenant_owner";
      to: string;
      inviteUrl: string;
      expiresAt: string;
    };
    const result = await sendInvitationEmail({
      ...data,
      queueDelivery: false,
    });
    if (result === "failed") {
      throw new Error("Invitation email delivery failed");
    }
    return { status: result };
  },
);

export const retryCarrierEventFunction = inngest.createFunction(
  {
    id: "retry-carrier-event",
    retries: 8,
    triggers: [{ event: "carrier/event.retry" }],
  },
  async ({ event }) => {
    const data = event.data as {
      tenantId: string;
      orderId: string;
      trackingNumber: string;
      status: "Processing" | "Shipped" | "Delivered";
      carrier?: string;
      eventId: string;
    };
    const response = await applyCarrierEvent(
      {
        eventId: data.eventId,
        tenantId: data.tenantId,
        orderId: data.orderId,
        trackingNumber: data.trackingNumber,
        status: data.status as CarrierEventStatus,
        ...(data.carrier ? { carrier: data.carrier } : {}),
      },
      "inngest-retry",
      { queueRetries: false },
    );
    if (!response.ok) {
      throw new Error(`Carrier event retry failed: ${response.status}`);
    }
    return { status: "processed" };
  },
);
