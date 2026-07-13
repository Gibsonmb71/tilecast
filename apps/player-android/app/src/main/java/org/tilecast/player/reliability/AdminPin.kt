package org.tilecast.player.reliability

import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

data class StoredPin(val salt:ByteArray,val hash:ByteArray,val iterations:Int=120000)
class AdminPinGate(private val maximumAttempts:Int=5,private val lockout:Duration=Duration.ofMinutes(5)) {
    private var failures=0; private var lockedUntil:Instant?=null
    fun create(pin:CharArray):StoredPin {require(pin.size in 4..12&&pin.all{it.isDigit()});val salt=ByteArray(16).also{SecureRandom().nextBytes(it)};return StoredPin(salt,derive(pin,salt,120000))}
    fun verify(pin:CharArray,stored:StoredPin,now:Instant=Instant.now()):Boolean {if(lockedUntil?.let{now<it}==true)return false;val actual=derive(pin,stored.salt,stored.iterations);val valid=java.security.MessageDigest.isEqual(actual,stored.hash);if(valid){failures=0;lockedUntil=null}else if(++failures>=maximumAttempts){lockedUntil=now.plus(lockout);failures=0};return valid}
    fun isLocked(now:Instant=Instant.now())=lockedUntil?.let{now<it}==true
    private fun derive(pin:CharArray,salt:ByteArray,iterations:Int)=SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(pin,salt,iterations,256)).encoded
}
