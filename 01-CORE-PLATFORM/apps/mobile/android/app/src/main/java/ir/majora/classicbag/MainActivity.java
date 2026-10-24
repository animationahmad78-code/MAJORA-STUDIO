package ir.majora.classicbag;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(InvoicePrintPlugin.class);
        registerPlugin(InvoiceMediaPlugin.class);
        registerPlugin(MajoraNavigationPlugin.class);
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge == null || bridge.getWebView() == null) { finish(); return; }
                bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(
                    "window.dispatchEvent(new Event('majora-back'))", null));
            }
        });
    }
}
