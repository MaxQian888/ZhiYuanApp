package com.zhiyuan.api;

import com.zhiyuan.domain.Models;
import com.zhiyuan.service.PlatformStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/users")
public class UserController {
    public record UserRequest(@NotBlank String username,@Pattern(regexp="^1[3-9]\\d{9}$") String phone){}
    public record AddressRequest(@NotBlank String receiverName,@Pattern(regexp="^1[3-9]\\d{9}$") String receiverPhone,@NotBlank String detail,double latitude,double longitude,boolean isDefault){}
    private final PlatformStore store;
    public UserController(PlatformStore store){this.store=store;}
    @GetMapping public ApiResponse<PageResponse<Models.User>> list(@RequestParam(defaultValue="")String q,@RequestParam(defaultValue="1")int page,@RequestParam(defaultValue="20")int size){return ApiResponse.ok(PageResponse.of(store.users(q),page,size));}
    @PostMapping public ApiResponse<Models.User> create(@Valid @RequestBody UserRequest body){return ApiResponse.ok(store.addUser(body.username(),body.phone()));}
    @PutMapping("/{id}") public ApiResponse<Models.User> update(@PathVariable long id,@Valid @RequestBody UserRequest body){return ApiResponse.ok(store.updateUser(id,body.username(),body.phone()));}
    @DeleteMapping("/{id}") public ApiResponse<Void> delete(@PathVariable long id){store.deleteUser(id);return ApiResponse.ok(null);}
    @PostMapping("/{id}/addresses") public ApiResponse<Models.Address> address(@PathVariable long id,@Valid @RequestBody AddressRequest body){return ApiResponse.ok(store.addAddress(id,body.receiverName(),body.receiverPhone(),body.detail(),body.latitude(),body.longitude(),body.isDefault()));}
    @PutMapping("/{userId}/addresses/{addressId}") public ApiResponse<Models.Address> updateAddress(@PathVariable long userId,@PathVariable long addressId,@Valid @RequestBody AddressRequest body){return ApiResponse.ok(store.updateAddress(userId,addressId,body.receiverName(),body.receiverPhone(),body.detail(),body.latitude(),body.longitude(),body.isDefault()));}
    @PatchMapping("/{userId}/addresses/{addressId}/default") public ApiResponse<Models.Address> defaultAddress(@PathVariable long userId,@PathVariable long addressId){return ApiResponse.ok(store.setDefaultAddress(userId,addressId));}
    @DeleteMapping("/{userId}/addresses/{addressId}") public ApiResponse<Void> deleteAddress(@PathVariable long userId,@PathVariable long addressId){store.deleteAddress(userId,addressId);return ApiResponse.ok(null);}
}
