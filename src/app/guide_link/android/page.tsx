import type { Metadata } from "next";
import { HOME_SCREEN_NAME } from "@/lib/brand";
import SetupSteps from "../SetupSteps";
import { PLATFORMS } from "../platforms";

export const metadata: Metadata = {
  title: `Add ${HOME_SCREEN_NAME} to your home screen — ${PLATFORMS.android.kicker}`,
};

export default function AndroidSetupPage() {
  return <SetupSteps platform="android" />;
}
