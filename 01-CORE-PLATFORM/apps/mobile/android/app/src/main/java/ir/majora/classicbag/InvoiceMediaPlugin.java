package ir.majora.classicbag;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.Manifest;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;
import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "InvoiceMedia", permissions = { @Permission(alias = "legacyGallery", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }) })
public class InvoiceMediaPlugin extends Plugin {
    @PluginMethod
    public void saveImages(PluginCall call) {
        JSArray paths = call.getArray("uris");
        if (paths == null || paths.length() == 0 || paths.length() > 40) { call.reject("No invoice images selected"); return; }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("legacyGallery") != PermissionState.GRANTED) {
            requestPermissionForAlias("legacyGallery", call, "galleryPermissionCallback"); return;
        }
        new Thread(() -> {
            try {
                File cache = getContext().getCacheDir().getCanonicalFile();
                ContentResolver resolver = getContext().getContentResolver();
                int saved = 0;
                for (int i = 0; i < paths.length(); i++) {
                    Uri sourceUri = Uri.parse(paths.getString(i));
                    if (!"file".equals(sourceUri.getScheme())) throw new IllegalArgumentException("Invalid invoice image URI");
                    File source = new File(sourceUri.getPath()).getCanonicalFile();
                    if (!source.getPath().startsWith(cache.getPath() + File.separator) || !source.isFile() || !source.getName().matches("classicbag-invoice-[A-Za-z0-9_-]+-page-[0-9]+\\.png"))
                        throw new IllegalArgumentException("Invoice image must be in private cache");
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Images.Media.DISPLAY_NAME, source.getName());
                    values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/MAJORA");
                        values.put(MediaStore.Images.Media.IS_PENDING, 1);
                    } else {
                        File folder = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "MAJORA");
                        if (!folder.isDirectory() && !folder.mkdirs()) throw new IllegalStateException("Cannot create gallery folder");
                        values.put(MediaStore.Images.Media.DATA, new File(folder, source.getName()).getAbsolutePath());
                    }
                    Uri target = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                    if (target == null) throw new IllegalStateException("Cannot create gallery entry");
                    try (FileInputStream input = new FileInputStream(source); OutputStream output = resolver.openOutputStream(target, "w")) {
                        if (output == null) throw new IllegalStateException("Cannot write gallery image");
                        byte[] buffer = new byte[65536]; int count;
                        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    } catch (Exception error) { resolver.delete(target, null, null); throw error; }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        values.clear(); values.put(MediaStore.Images.Media.IS_PENDING, 0);
                        resolver.update(target, values, null, null);
                    }
                    saved++;
                }
                JSObject result = new JSObject(); result.put("saved", saved); call.resolve(result);
            } catch (Exception error) { call.reject("Cannot save invoice images to gallery", error); }
        }).start();
    }
    @PermissionCallback
    private void galleryPermissionCallback(PluginCall call) {
        if (getPermissionState("legacyGallery") == PermissionState.GRANTED) saveImages(call);
        else call.reject("Gallery permission was denied");
    }
}
