import { z } from "zod";

export const ProductReviewSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  productId: z.string().min(1).max(128),
  customerId: z.uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  createdAt: z.iso.datetime(),
});

export type ProductReview = z.infer<typeof ProductReviewSchema>;

export const ProductReviewInputSchema = z.object({
  productId: z.string().min(1).max(128),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
});

export type ProductReviewInput = z.infer<typeof ProductReviewInputSchema>;
