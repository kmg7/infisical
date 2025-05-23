// Code generated by automation script, DO NOT EDIT.
// Automated by pulling database and generating zod schema
// To update. Just run npm run generate:schema
// Written by akhilmhdh.

import { z } from "zod";

import { TImmutableDBKeys } from "./models";

export const KmipClientCertificatesSchema = z.object({
  id: z.string().uuid(),
  kmipClientId: z.string().uuid(),
  serialNumber: z.string(),
  keyAlgorithm: z.string(),
  issuedAt: z.date(),
  expiration: z.date()
});

export type TKmipClientCertificates = z.infer<typeof KmipClientCertificatesSchema>;
export type TKmipClientCertificatesInsert = Omit<z.input<typeof KmipClientCertificatesSchema>, TImmutableDBKeys>;
export type TKmipClientCertificatesUpdate = Partial<
  Omit<z.input<typeof KmipClientCertificatesSchema>, TImmutableDBKeys>
>;
