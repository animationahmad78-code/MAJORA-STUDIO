package ir.majora.classicbag;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "BackupTransfer")
public class BackupTransferPlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        String uriText = call.getString("uri");
        String filename = call.getString("filename");
        if (uriText == null || filename == null || !filename.matches("majora-backup-[0-9TZ-]+\\.zip")) {
            call.reject("Invalid backup file request"); return;
        }
        try {
            Uri uri = Uri.parse(uriText);
            if (!"file".equals(uri.getScheme())) { call.reject("Backup must be in app cache"); return; }
            File source = new File(uri.getPath()).getCanonicalFile();
            File cache = getContext().getCacheDir().getCanonicalFile();
            if (!source.getPath().startsWith(cache.getPath() + File.separator) || !source.isFile() || source.length() == 0) {
                call.reject("Backup is not available in app cache"); return;
            }
            Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            save.addCategory(Intent.CATEGORY_OPENABLE);
            save.setType("application/zip");
            save.putExtra(Intent.EXTRA_TITLE, filename);
            startActivityForResult(call, save, "saveResult");
        } catch (Exception error) { call.reject("Cannot open Android save dialog", error); }
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject response = new JSObject(); response.put("saved", false); call.resolve(response); return;
        }
        Uri destination = result.getData().getData();
        new Thread(() -> {
            try {
                File source = new File(Uri.parse(call.getString("uri")).getPath()).getCanonicalFile();
                File cache = getContext().getCacheDir().getCanonicalFile();
                if (!source.getPath().startsWith(cache.getPath() + File.separator) || !source.isFile()) {
                    call.reject("Backup source changed before saving"); return;
                }
                try (FileInputStream input = new FileInputStream(source);
                     OutputStream output = getContext().getContentResolver().openOutputStream(destination, "w")) {
                    if (output == null) throw new IllegalStateException("Cannot write selected document");
                    byte[] buffer = new byte[65536]; int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    output.flush();
                }
                JSObject response = new JSObject(); response.put("saved", true); call.resolve(response);
            } catch (Exception error) { call.reject("Cannot save backup ZIP", error); }
        }).start();
    }
}
