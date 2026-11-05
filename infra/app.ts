import { App } from "aws-cdk-lib";
import { SignalsMockStack } from "./mock-stack.js";

new SignalsMockStack(new App(), "MorokuSignalsMock-dev", {
  env: { account: "932027117528", region: "ap-southeast-2" },
  assetPath: "dist/mock-lambda",
});
