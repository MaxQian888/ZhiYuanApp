package com.zhiyuan.persistence;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

public interface AdminMapper {
    @Select("SELECT id, username, password_hash, display_name, role, phone, enabled, token_version, mfa_secret, mfa_enabled, mfa_last_step FROM admins WHERE username = #{username} LIMIT 1")
    AdminEntity findByUsername(@Param("username") String username);

    @Select("SELECT id, username, password_hash, display_name, role, phone, enabled, token_version, mfa_secret, mfa_enabled, mfa_last_step FROM admins WHERE id = #{id} LIMIT 1")
    AdminEntity findById(@Param("id") long id);

    @Select("SELECT id, username, password_hash, display_name, role, phone, enabled, token_version, mfa_secret, mfa_enabled, mfa_last_step FROM admins ORDER BY id")
    List<AdminEntity> findAll();

    @Select("SELECT COUNT(*) FROM admins WHERE username = #{username} AND id <> #{excludeId}")
    int countByUsernameExcept(@Param("username") String username, @Param("excludeId") long excludeId);

    @Select("SELECT COUNT(*) FROM admins WHERE phone = #{phone} AND id <> #{excludeId}")
    int countByPhoneExcept(@Param("phone") String phone, @Param("excludeId") long excludeId);

    @Insert("INSERT INTO admins (username, password_hash, display_name, role, phone, enabled) VALUES (#{username}, #{passwordHash}, #{displayName}, #{role}, #{phone}, #{enabled})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(AdminEntity admin);

    @Update("UPDATE admins SET username = #{username}, display_name = #{displayName}, role = #{role}, phone = #{phone}, enabled = #{enabled} WHERE id = #{id}")
    int updateAccount(AdminEntity admin);

    @Update("UPDATE admins SET enabled = #{enabled}, token_version = token_version + 1 WHERE id = #{id}")
    int updateEnabled(@Param("id") long id, @Param("enabled") boolean enabled);

    @Update("UPDATE admins SET password_hash = #{hash}, token_version = token_version + 1 WHERE id = #{id}")
    int updatePassword(@Param("id") long id, @Param("hash") String hash);

    @Update("UPDATE admins SET token_version = token_version + 1 WHERE id = #{id}")
    int bumpTokenVersion(@Param("id") long id);

    @Update("UPDATE admins SET display_name = #{displayName}, phone = #{phone} WHERE id = #{id}")
    int updateProfile(@Param("id") long id, @Param("displayName") String displayName, @Param("phone") String phone);

    /** Stores a secret without enabling it: enrolment is not complete until confirmed. */
    @Update("UPDATE admins SET mfa_secret = #{secret}, mfa_enabled = FALSE, mfa_last_step = NULL WHERE id = #{id}")
    int stageMfaSecret(@Param("id") long id, @Param("secret") String secret);

    @Update("UPDATE admins SET mfa_enabled = #{enabled} WHERE id = #{id}")
    int updateMfaEnabled(@Param("id") long id, @Param("enabled") boolean enabled);

    @Update("UPDATE admins SET mfa_secret = NULL, mfa_enabled = FALSE, mfa_last_step = NULL WHERE id = #{id}")
    int clearMfa(@Param("id") long id);

    /**
     * Advances the replay guard, but only forwards.
     *
     * <p>The comparison is in the WHERE clause so two instances handling the same code
     * concurrently cannot both succeed: exactly one update matches, the other sees zero rows
     * and rejects the code as replayed.
     *
     * @return 1 when the step was accepted, 0 when this code has already been spent
     */
    @Update("UPDATE admins SET mfa_last_step = #{step} WHERE id = #{id}"
        + " AND (mfa_last_step IS NULL OR mfa_last_step < #{step})")
    int advanceMfaStep(@Param("id") long id, @Param("step") long step);
}
