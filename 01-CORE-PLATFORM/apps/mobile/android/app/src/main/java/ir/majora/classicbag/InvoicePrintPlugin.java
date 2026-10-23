package ir.majora.classicbag;

import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;

@CapacitorPlugin(name = "InvoicePrint")
public class InvoicePrintPlugin extends Plugin {
    @PluginMethod
    public void print(PluginCall call) {
        String uriText = call.getString("uri");
        String paper = call.getString("paper", "a4");
        String title = call.getString("title", "MAJORA Invoice");
        if (uriText == null || !(paper.equals("a4") || paper.equals("a5"))) {
            call.reject("Invalid print request"); return;
        }
        try {
            Uri uri = Uri.parse(uriText);
            File source = new File(uri.getPath()).getCanonicalFile();
            File cache = getContext().getCacheDir().getCanonicalFile();
            if (!source.getPath().startsWith(cache.getPath() + File.separator) || !source.isFile() || source.length() == 0) {
                call.reject("PDF is not available in app cache"); return;
            }
            getActivity().runOnUiThread(() -> {
                PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                if (manager == null) { call.reject("Android print service is unavailable"); return; }
                PrintAttributes.MediaSize size = paper.equals("a5") ? PrintAttributes.MediaSize.ISO_A5 : PrintAttributes.MediaSize.ISO_A4;
                PrintAttributes attributes = new PrintAttributes.Builder().setMediaSize(size).setMinMargins(PrintAttributes.Margins.NO_MARGINS).build();
                manager.print(title, new PdfAdapter(source, title), attributes);
                JSObject result = new JSObject(); result.put("opened", true); call.resolve(result);
            });
        } catch (Exception error) { call.reject("Cannot open print dialog", error); }
    }

    private static class PdfAdapter extends PrintDocumentAdapter {
        private final File source;
        private final String title;
        PdfAdapter(File source, String title) { this.source = source; this.title = title; }
        @Override
        public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes, CancellationSignal cancellation, LayoutResultCallback callback, Bundle extras) {
            if (cancellation.isCanceled()) { callback.onLayoutCancelled(); return; }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder(title + ".pdf")
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN).build();
            callback.onLayoutFinished(info, true);
        }
        @Override
        public void onWrite(PageRange[] pageRanges, ParcelFileDescriptor destination, CancellationSignal cancellation, WriteResultCallback callback) {
            new Thread(() -> {
                try (FileInputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(destination.getFileDescriptor())) {
                    byte[] buffer = new byte[65536]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (cancellation.isCanceled()) { callback.onWriteCancelled(); return; }
                        output.write(buffer, 0, count);
                    }
                    output.flush();
                    callback.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
                } catch (Exception error) { callback.onWriteFailed(error.getMessage()); }
            }).start();
        }
    }
}
