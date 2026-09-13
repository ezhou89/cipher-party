import { z } from "zod";

// Run before App/router imports construct protocol schemas. Even Zod's caught
// Function capability probe violates the browser's enforced script-src policy.
z.config({ jitless: true });
