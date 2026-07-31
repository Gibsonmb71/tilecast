export type ScreenPlatformFamily = "android" | "linux";

// Screens report a specific platform string ("fire-tv", "android-tv",
// "linux", …); anything that is not Linux belongs to the Android family, the
// same mapping the server applies when resolving deployment targets.
export const screenPlatformFamily = (platform: string): ScreenPlatformFamily =>
  platform === "linux" ? "linux" : "android";

export const isAndroidScreen = (platform: string) =>
  screenPlatformFamily(platform) === "android";
