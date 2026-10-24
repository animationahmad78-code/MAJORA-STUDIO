package ir.majora.classicbag;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MajoraNavigation")
public class MajoraNavigationPlugin extends Plugin {
    @PluginMethod
    public void exit(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            call.resolve();
            getActivity().finish();
        });
    }
}
