import MtdItApproveClient from './MtdItApproveClient';

// PUBLIC route — lives OUTSIDE the (app) group so the auth-required layout
// doesn't fire. The token in the URL is the only credential.
export default function Page({ params }: { params: { token: string } }) {
  return <MtdItApproveClient token={params.token} />;
}
