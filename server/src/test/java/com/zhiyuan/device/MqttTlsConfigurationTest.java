package com.zhiyuan.device;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import javax.net.ssl.SSLSocketFactory;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MqttTlsConfigurationTest {

    @TempDir
    Path temporaryDirectory;

    @Test
    void leavesTheLocalPlaintextBrokerUnchangedWhenNoTlsMaterialIsConfigured() {
        MqttTlsConfiguration tls = new MqttTlsConfiguration("", "", "", "");

        assertThat(tls.socketFactory()).isNull();
    }

    @Test
    void rejectsAOneSidedTlsConfiguration() {
        MqttTlsConfiguration tls = new MqttTlsConfiguration(
            "/run/secrets/platform.p12", "changeit", "", "");

        assertThatThrownBy(tls::socketFactory)
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("key store and trust store");
    }

    @Test
    void createsAJsseSocketFactoryFromPkcs12Stores() throws Exception {
        Path keyStore = emptyPkcs12("platform.p12");
        Path trustStore = emptyPkcs12("ca.p12");
        MqttTlsConfiguration tls = new MqttTlsConfiguration(
            keyStore.toString(), "changeit", trustStore.toString(), "changeit");

        assertThat(tls.socketFactory()).isInstanceOf(SSLSocketFactory.class);
    }

    @Test
    void reportsUnreadableCertificateMaterialBeforeConnecting() {
        MqttTlsConfiguration tls = new MqttTlsConfiguration(
            temporaryDirectory.resolve("missing-key.p12").toString(), "changeit",
            temporaryDirectory.resolve("missing-ca.p12").toString(), "changeit");

        assertThatThrownBy(tls::socketFactory)
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Could not load MQTT TLS material");
    }

    private Path emptyPkcs12(String name) throws Exception {
        Path path = temporaryDirectory.resolve(name);
        KeyStore store = KeyStore.getInstance("PKCS12");
        store.load(null, null);
        try (OutputStream output = Files.newOutputStream(path)) {
            store.store(output, "changeit".toCharArray());
        }
        return path;
    }
}
