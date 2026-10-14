import type express from "express";
import type { Request, Response } from "express";
import appJson from "../../app.json" with { type: "json" };

const { bundleIdentifier } = appJson.expo.ios;
const { package: androidPackage } = appJson.expo.android;

/** Each file answers 404 until the deploy sets its value: `docs/DEPLOY-RUNBOOK.md` § Secrets. */
export function registerAppLinks(app: express.Application) {
  app.get("/.well-known/apple-app-site-association", (_req: Request, res: Response) => {
    const team = process.env.APPLE_TEAM_ID?.trim();
    if (!team) return res.status(404).end();
    res.json({ applinks: { details: [{ appIDs: [`${team}.${bundleIdentifier}`], components: [{ "/": "/join/*" }] }] } });
  });

  app.get("/.well-known/assetlinks.json", (_req: Request, res: Response) => {
    const cert = process.env.ANDROID_CERT_SHA256?.trim();
    if (!cert) return res.status(404).end();
    res.json([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: androidPackage, sha256_cert_fingerprints: [cert] },
      },
    ]);
  });
}
