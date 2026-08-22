package com.zhiyuan.persistence;

public class AdminEntity {
    private Long id;
    private String username;
    private String passwordHash;
    private String displayName;
    private String role;
    private String phone;
    private Boolean enabled;
    private Long tokenVersion;
    private String mfaSecret;
    private Boolean mfaEnabled;
    /** The last TOTP time step accepted for this account; the replay guard. */
    private Long mfaLastStep;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getPasswordHash() { return passwordHash; }
    public void setPasswordHash(String passwordHash) { this.passwordHash = passwordHash; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }
    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
    public String getPhone() { return phone; }
    public void setPhone(String phone) { this.phone = phone; }
    public Boolean getEnabled() { return enabled; }
    public void setEnabled(Boolean enabled) { this.enabled = enabled; }
    public Long getTokenVersion() { return tokenVersion; }
    public void setTokenVersion(Long tokenVersion) { this.tokenVersion = tokenVersion; }
    public String getMfaSecret() { return mfaSecret; }
    public void setMfaSecret(String mfaSecret) { this.mfaSecret = mfaSecret; }
    public Boolean getMfaEnabled() { return mfaEnabled; }
    public void setMfaEnabled(Boolean mfaEnabled) { this.mfaEnabled = mfaEnabled; }
    public Long getMfaLastStep() { return mfaLastStep; }
    public void setMfaLastStep(Long mfaLastStep) { this.mfaLastStep = mfaLastStep; }

    /** Whether this account must present a second factor to sign in. */
    public boolean mfaRequired() {
        return Boolean.TRUE.equals(mfaEnabled) && mfaSecret != null && !mfaSecret.isBlank();
    }
}
