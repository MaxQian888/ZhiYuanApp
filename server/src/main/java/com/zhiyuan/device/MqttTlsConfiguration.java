package com.zhiyuan.device;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManagerFactory;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

/** Loads the platform MQTT client identity and its private broker trust roots. */
public record MqttTlsConfiguration(String keyStorePath, String keyStorePassword,
                                   String trustStorePath, String trustStorePassword) {

    /**
     * @return a mutual-TLS socket factory, or {@code null} for the local plaintext broker
     */
    public SSLSocketFactory socketFactory() {
        if (allBlank()) return null;
        if (anyBlank()) {
            throw new IllegalStateException(
                "MQTT TLS requires both key store and trust store paths and passwords");
        }
        try {
            KeyStore keyStore = load(keyStorePath, keyStorePassword);
            KeyManagerFactory keys = KeyManagerFactory.getInstance(
                KeyManagerFactory.getDefaultAlgorithm());
            keys.init(keyStore, keyStorePassword.toCharArray());

            KeyStore trustStore = load(trustStorePath, trustStorePassword);
            TrustManagerFactory trust = TrustManagerFactory.getInstance(
                TrustManagerFactory.getDefaultAlgorithm());
            trust.init(trustStore);

            SSLContext context = SSLContext.getInstance("TLS");
            context.init(keys.getKeyManagers(), trust.getTrustManagers(), null);
            return context.getSocketFactory();
        } catch (Exception failure) {
            throw new IllegalStateException("Could not load MQTT TLS material", failure);
        }
    }

    private static KeyStore load(String path, String password) throws Exception {
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (InputStream input = Files.newInputStream(Path.of(path))) {
            store.load(input, password.toCharArray());
        }
        return store;
    }

    private boolean allBlank() {
        return isBlank(keyStorePath) && isBlank(keyStorePassword)
            && isBlank(trustStorePath) && isBlank(trustStorePassword);
    }

    private boolean anyBlank() {
        return isBlank(keyStorePath) || isBlank(keyStorePassword)
            || isBlank(trustStorePath) || isBlank(trustStorePassword);
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
