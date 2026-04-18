import { deMessages } from "./de";
import { enMessages } from "./en";

export type MessageKey = keyof typeof deMessages;

export const MESSAGES = {
  de: deMessages,
  en: enMessages
} as const;
