import { createAuthClient } from "better-auth/react";

/** The browser side of the built-in login; same origin, so no URL. */
export const authClient = createAuthClient();
