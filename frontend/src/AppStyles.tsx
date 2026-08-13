// Keep the unauthenticated entry page lean. These application-wide styles are
// loaded only after AuthGate has verified a session and the workspace is about
// to render.
import "./styles.css";
import "./styles/primitives.css";
import "./styles/careerloop.css";

export default function AppStyles() {
  return null;
}
