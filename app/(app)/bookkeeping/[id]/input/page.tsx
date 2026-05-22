import { redirect } from 'next/navigation';

// The Input sheet now lives as a sub-tab inside the book view. This route
// stays as a deep-link alias — anything pointing at /bookkeeping/<id>/input
// (bookmarks, old emails, the recent activity feed) lands on the right tab.
export default function BookInputPage({ params }: { params: { id: string } }) {
  redirect(`/bookkeeping/${params.id}?tab=input`);
}
