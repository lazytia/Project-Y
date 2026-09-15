import type { Metadata } from "next";
import { HOME_SCREEN_NAME } from "@/lib/brand";
import SetupSteps from "../SetupSteps";
import { PLATFORMS } from "../platforms";

export const metadata: Metadata = {
  title: `Add ${HOME_SCREEN_NAME} to your home screen — ${PLATFORMS.iphone.kicker}`,
};

export default function IPhoneSetupPage() {
  return <SetupSteps platform="iphone" />;
}
