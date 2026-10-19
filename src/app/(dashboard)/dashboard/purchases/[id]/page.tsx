import { PurchaseStatus } from "@/components/seasons/purchase-status";

// Where Stripe sends a buyer after paying for a season (the success URL the
// checkout route builds). Stripe can send them back before the webhook has
// run, so the page reads the purchase row and waits — it never assumes the
// season exists yet. The row is readable by members of its league only (RLS).
export default function PurchasePage({ params }: { params: { id: string } }) {
  return <PurchaseStatus purchaseId={params.id} />;
}
