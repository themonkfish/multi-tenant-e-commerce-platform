import { serve } from "inngest/next";
import {
  inngest,
  retryCarrierEventFunction,
  sendPasswordResetEmailFunction,
  sendInvitationEmailFunction,
} from "@/lib/server/inngest-functions";

export const runtime = "nodejs";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    sendInvitationEmailFunction,
    retryCarrierEventFunction,
    sendPasswordResetEmailFunction,
  ],
});
