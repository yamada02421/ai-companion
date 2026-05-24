import { OpenPetsClient, type OpenPetsReaction } from "@ai-companion/core";

const message = process.argv[2] ?? "";
const reaction = (process.argv[3] ?? "working") as OpenPetsReaction;

if (!message) process.exit(0);

const openpets = new OpenPetsClient();
await openpets.say(message, reaction).catch(() => {});
