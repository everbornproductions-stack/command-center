// Registers nothing of its own. app.js installs the tip and the dismiss click.
// This file stays in the feature list so the module is part of the app build.
import { tipHtml } from "/sign-in-tip.js";

if (!window.CC.passwordTipHtml) window.CC.passwordTipHtml = () => tipHtml(localStorage);
