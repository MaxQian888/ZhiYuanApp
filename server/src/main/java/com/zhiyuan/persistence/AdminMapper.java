package com.zhiyuan.persistence;

import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

public interface AdminMapper {
    @Select("SELECT id, username, password_hash, display_name, role, phone, enabled FROM admins WHERE username = #{username} LIMIT 1")
    AdminEntity findByUsername(@Param("username") String username);

    @Select("SELECT id, username, password_hash, display_name, role, phone, enabled FROM admins WHERE id = #{id} LIMIT 1")
    AdminEntity findById(@Param("id") long id);

    @Select("SELECT id, username, password_hash, display_name, role, phone, enabled FROM admins ORDER BY id")
    List<AdminEntity> findAll();

    @Update("UPDATE admins SET password_hash = #{hash} WHERE id = #{id}")
    int updatePassword(@Param("id") long id, @Param("hash") String hash);

    @Update("UPDATE admins SET display_name = #{displayName}, phone = #{phone} WHERE id = #{id}")
    int updateProfile(@Param("id") long id, @Param("displayName") String displayName, @Param("phone") String phone);
}
