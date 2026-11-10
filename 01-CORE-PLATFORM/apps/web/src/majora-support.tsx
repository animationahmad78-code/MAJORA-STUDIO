import { MajoraAbout } from '../../mobile/src/majora-about';

export function MajoraSupport() {
  return <MajoraAbout logo="/brand/majora-logo.png" onBack={() => { window.location.hash = '#/dashboard'; }} />;
}
