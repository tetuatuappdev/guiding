import * as Linking from "expo-linking";
import { supabase } from "../services/supabase";

export const openInvoice = async (pdfPath) => {
  if (!pdfPath) return;

  let path = pdfPath;

  const m = path.match(/\/invoices\/(.+)$/);
  if (m && m[1]) path = m[1];

  path = path.replace(/^invoices\//, "").split("?")[0];

  const { data, error } = await supabase.storage
    .from("invoices")
    .createSignedUrl(path, 60);

  if (error) {
    console.log("openInvoice error", error, { pdfPath, path });
    return;
  }

  if (data?.signedUrl) Linking.openURL(data.signedUrl);
};
