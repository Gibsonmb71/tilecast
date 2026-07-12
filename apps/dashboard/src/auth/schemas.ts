import { z } from "zod";

export const setupSchema = z
  .object({
    organizationName: z
      .string()
      .trim()
      .min(2, "Enter an organization name")
      .max(120),
    ownerName: z.string().trim().min(2, "Enter your name").max(120),
    username: z
      .string()
      .trim()
      .min(3, "Use at least 3 characters")
      .max(254)
      .regex(/^[a-zA-Z0-9._@+-]+$/, "Use letters, numbers, or . _ @ + -"),
    password: z.string().min(12, "Use at least 12 characters").max(1024),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Enter your username"),
  password: z.string().min(1, "Enter your password"),
});

export type SetupForm = z.infer<typeof setupSchema>;
export type LoginForm = z.infer<typeof loginSchema>;
