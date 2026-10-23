package ir.majora.classicbag;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(InvoicePrintPlugin.class);
        registerPlugin(BackupTransferPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
